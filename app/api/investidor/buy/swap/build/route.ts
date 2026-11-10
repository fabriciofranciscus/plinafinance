/**
 * POST /api/investidor/buy/swap/build
 *
 * Monta o envelope atômico de emissão de PLINARF — duas legs no mesmo
 * envelope assinado: (1) investor → distributor em TESOURO; (2) issuer
 * → investor em PLINARF (emissão nova). O investidor assina via Privy; a Plina NÃO assina no
 * build (N1/L1-S3): o issuer assina só no /swap/submit, depois de validar o XDR.
 *
 * Pré-condições:
 *   - Quote válido (não expirado, não consumido) e pertencente ao investor.
 *   - OnRampOrder ligada ao quote com status=completed (TESOURO settled).
 *   - Investor tem trustline PLINARF autorizada + trustline TESOURO.
 *
 * Modo mock (PLINA-MOD-005 bypass): quando a order é mock (sandbox sem
 * iframe), não há TESOURO real na wallet — emissão cai num caminho
 * direto (emissão single-shot pelo issuer) executado server-side. Marca audit log.
 *
 * Body: { quoteId, investorPubkey, investidorId? }
 * Returns (real): { xdr, hashHex, mock: false } — XDR sem nenhuma assinatura da Plina
 * Returns (mock): { txHash, mock: true, alreadyExecuted: true }
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { issueAsset, createTrustline } from '@/lib/stellar/issuer';
import { distributorSigner, issuerSigner } from '@/lib/stellar/signer';
import { NavMudouError, revalidarNavDaCotacao } from '@/lib/services/emissao';
import { NAV_INDISPONIVEL_MENSAGEM, NavIndisponivelError } from '@/lib/services/nav-supply';
import { mainnetCutoverGuard } from '@/lib/env/feature-gates';
import { buildAsset, loadAccount } from '@/lib/stellar/account';
import { logStellarError } from '@/lib/stellar/log-error';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';
import { registrarMovimentoFundo } from '@/lib/services/razao-fundo';
import { incrementarHolding } from '@/lib/services/holdings';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { stellarPubkey } from '@/lib/http/zod-stellar';
import { sandboxMockAllowed } from '@/lib/env/etherfuse';

export const dynamic = 'force-dynamic';

/**
 * Garante (idempotente) que o distributor confia no TESOURO pra receber a leg 1
 * do swap. Setup global único: se a trustline já existe, no-op; senão cria
 * (changeTrust assinado pelo distributor server-side).
 */
async function ensureDistributorTesouroTrustline(
  distributorPubkey: string,
  tesouro: { code: string; issuer: string },
): Promise<void> {
  const acc = await loadAccount(distributorPubkey);
  const lines = acc.balances as Array<{
    asset_code?: string;
    asset_issuer?: string;
  }>;
  const has = lines.some(
    (b) => b.asset_code === tesouro.code && b.asset_issuer === tesouro.issuer,
  );
  if (has) return;
  try {
    await createTrustline(distributorSigner(), tesouro.issuer, tesouro.code);
  } catch (err) {
    // Corrida (outro request criou) ou trustline já presente → segue.
    logStellarError('[swap/build] distributor trust TESOURO', err);
  }
}

const Schema = z
  .object({
    quoteId: z.string().min(1).max(60),
    investorPubkey: stellarPubkey(),
    investidorId: z.string().min(1).max(60).optional(),
  })
  .strict();

export const POST = withApi(async (req, { requestId }) => {
  // Guard de cutover devolve NextResponse cru — passa direto pelo withApi.
  const cutover = await mainnetCutoverGuard();
  if (cutover) return cutover;

  const user = await requireInvestidor(req);
  const { quoteId, investorPubkey, investidorId } = Schema.parse(
    await req.json(),
  );

  if (user.publicKey !== investorPubkey) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'investorPubkey não corresponde ao investidor autenticado',
    );
  }

  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: {
      investidor: true,
      onRampOrder: true,
    },
  });
  if (!quote) {
    throw new ApiError('NOT_FOUND', 404, 'quote não encontrado');
  }
  if (quote.investidorId !== user.investidorId) {
    throw new ApiError('FORBIDDEN', 403, 'quote pertence a outro investidor');
  }
  if (investidorId && quote.investidorId !== investidorId) {
    throw new ApiError('FORBIDDEN', 403, 'investidorId não bate com o quote');
  }
  if (quote.consumedAt) {
    throw new ApiError('CONFLICT', 409, 'quote já consumido');
  }
  // L1-S2: o quote expira mesmo com o onramp `completed`. O preço de emissão
  // (NAV congelado na cotação) só vale dentro da janela do quote.
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new ApiError('GONE', 410, 'quote expirado');
  }
  if (!quote.onRampOrder) {
    throw new ApiError(
      'CONFLICT',
      409,
      'onramp ainda não criada — POST /onramp/create primeiro',
    );
  }
  if (quote.onRampOrder.status !== 'completed') {
    throw new ApiError(
      'CONFLICT',
      409,
      `onramp em status=${quote.onRampOrder.status}; aguardando settlement TESOURO`,
    );
  }

  await assertElegivelParaTrustline({
    investidorId: quote.investidorId,
    publicKey: investorPubkey,
  });

  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorSecret = process.env.STELLAR_DISTRIBUTOR_SECRET;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorSecret || !distributorPubkey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('Stellar issuer/distributor não configurados');
  }

  // M1-3: o PLINARF emitido NÃO é 1:1 com o TESOURO pago. Quantidade e NAV
  // vêm congelados do quote (BRL ÷ NAV). Quote sem preço de emissão (legado ou
  // anterior ao M1-3) é recusado: nunca cai em 1:1.
  if (!quote.plinarfAmount || !quote.navPorTokenNaCotacao) {
    throw new ApiError(
      'CONFLICT',
      409,
      'cotação sem preço de emissão ao NAV — refaça a cotação',
    );
  }
  // L1-S2: relê o NAV antes de montar/emitir; mudou além de 1 bp → recotar.
  // Sem NAV (ledger fora, PLINARFB circulando) → 503 constante.
  try {
    await revalidarNavDaCotacao({
      fromAmount: quote.fromAmount,
      navPorTokenNaCotacao: quote.navPorTokenNaCotacao,
    });
  } catch (err) {
    if (err instanceof NavMudouError) {
      throw new ApiError('NAV_MUDOU', 409, err.message);
    }
    if (err instanceof NavIndisponivelError) {
      console.error('[swap/build] NAV indisponível', { requestId, motivo: err.motivo });
      throw new ApiError('LEDGER_UNAVAILABLE', 503, NAV_INDISPONIVEL_MENSAGEM);
    }
    throw err;
  }
  const navNaCotacao = quote.navPorTokenNaCotacao.toFixed(8);
  const bridgeAmount = quote.toAmount.toFixed(7); // TESOURO pago (perna 1)
  const stellarAmount = quote.plinarfAmount.toFixed(7); // PLINARF emitido (perna 2)
  const classe = classeOrDefault(quote.classe);
  const plinarfCode = assetCodeForClasse(classe);

  const instructions = quote.onRampOrder.paymentInstructionsJson as
    | (Record<string, unknown> & { __mock?: boolean })
    | null;
  const mock = instructions?.__mock === true;

  // Defesa em profundidade: uma order mock NUNCA pode emitir PLINARF sem
  // perna TESOURO fora de sandbox (ex.: dados de testnet num DB promovido a
  // mainnet). `issueAsset` é free-mint — recusa antes de tocar a chain.
  if (mock && !sandboxMockAllowed()) {
    throw new ApiError(
      'CONFLICT',
      409,
      'order mock fora de sandbox — emissão recusada',
    );
  }

  if (mock) {
    // Sem TESOURO real na wallet — emissão direta server-side, consumo
    // atômico do quote + audit log marcando mock.
    if (!process.env.STELLAR_ISSUER_SECRET) {
      throw new Error('Stellar issuer não configurado');
    }
    // N1: a subscrição EMITE token novo (issuer → investidor, supply +q). Pagar
    // do distributor tiraria da posição legada da Plina e o NAV subiria a cada venda.
    const distRes = await issueAsset(
      issuerSigner(),
      investorPubkey,
      stellarAmount,
      plinarfCode,
      { memoHash: createHash('sha256').update(`plina:subscricao:${quote.id}`).digest() },
    );

    await db.$transaction(async (tx) => {
      const consumed = await tx.quote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: {
          consumedAt: new Date(),
          consumedTxHash: distRes.hash,
        },
      });
      if (consumed.count !== 1) {
        throw new Error('quote consumido concorrentemente — abortando');
      }
      await tx.investidor.update({
        where: { id: quote.investidorId },
        data: {
          saldoEsperado: {
            increment: new Prisma.Decimal(stellarAmount),
          },
        },
      });
      await incrementarHolding(tx, {
        investidorId: quote.investidorId,
        classe,
        amount: stellarAmount,
        txHash: distRes.hash,
      });
      await registrarMovimentoFundo(tx, {
        tipo: 'SUBSCRICAO',
        valorBrl: quote.fromAmount,
        tokens: stellarAmount,
        chave: `subscricao:${quote.id}`,
        quoteId: quote.id,
        refHash: distRes.hash,
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'SWAP_EXECUTADO',
          operador: 'sandbox-mock',
          investidorId: quote.investidorId,
          privyId: user.privyId,
          stellarTxHash: distRes.hash,
          payloadJson: {
            quoteId: quote.id,
            orderId: quote.onRampOrder?.id,
            amount: stellarAmount,
            navPorTokenNaCotacao: navNaCotacao,
            classe,
            assetCode: plinarfCode,
            mock: true,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return ok(
      { txHash: distRes.hash, mock: true, alreadyExecuted: true },
      { requestId },
    );
  }

  // Real: envelope atômico com 2 legs.
  const tesouro = await resolveTesouroAsset(investorPubkey);
  const bridgeAsset = buildAsset(tesouro.issuer, tesouro.code);

  // O distributor precisa de trustline TESOURO pra RECEBER a leg 1
  // (investor → distributor). Sem isso a tx falha com op_no_trust na primeira
  // operação. Setup único e global: checa antes, só cria se faltar.
  await ensureDistributorTesouroTrustline(distributorPubkey, tesouro);

  // Perna TESOURO = quote.toAmount; perna PLINARF = quote.plinarfAmount
  // (quantidadeEmitida ao NAV da cotação). Valores distintos.
  const { xdr, hashHex } = await buildSwapBridgeForPlinarfXdr({
    investorPubkey,
    bridgeAsset,
    bridgeAmount,
    plinarfAmount: stellarAmount,
    issuerPubkey,
    distributorPubkey,
    plinarfCode,
    memo: `q:${quote.id.slice(0, 24)}`,
  });

  // N1 + L1-S1/S3: o build NÃO assina nada pela Plina nem devolve chave pública.
  // O investidor assina o envelope e o /swap/submit valida o XDR contra as
  // chaves do env, só então acrescenta a assinatura do issuer e submete.
  return ok(
    {
      xdr,
      hashHex,
      mock: false,
    },
    { requestId },
  );
});
