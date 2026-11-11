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
 * Returns (real): { xdr, hashHex, quoteId, mock: false, plinarfAmount, navPorTokenNaCotacao } — XDR sem nenhuma assinatura da Plina;
 *   `quoteId` é o quote a usar no submit (novo se o anterior expirou — recotar)
 * Returns (mock): { txHash, mock: true, alreadyExecuted: true }
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { issueAsset, createTrustline } from '@/lib/stellar/issuer';
import { distributorSigner, issuerSigner } from '@/lib/stellar/signer';
import { renovarCotacaoParaSwap } from '@/lib/services/cotacao-swap';
import { NAV_INDISPONIVEL_MENSAGEM, NavIndisponivelError } from '@/lib/services/nav-supply';
import { mainnetCutoverGuard } from '@/lib/env/feature-gates';
import { buildAsset, loadAccount } from '@/lib/stellar/account';
import { logStellarError } from '@/lib/stellar/log-error';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';
import { assertClasseDisponivel, valorLiquidoDaCotacao } from '@/lib/services/regras-swap';
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
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  // O N1 não assina mais com o distributor: só as chaves PÚBLICAS são necessárias aqui.
  if (!issuerPubkey || !distributorPubkey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('Stellar issuer/distributor não configurados');
  }

  // M1-3: o PLINARF emitido NÃO é 1:1 com o TESOURO pago: quantidade e NAV vêm do
  // preço de emissão. Quote sem preço (legado) é precificado aqui, no recotar.
  // L1-S2 + recotar: o build RELÊ o NAV e atualiza `navPorTokenNaCotacao` e
  // `plinarfAmount` do quote (cotação expirada → quote novo, ordem religada). O
  // submit recusa com 409 NAV_MUDOU se o NAV divergir mais de 1 bp DESTE preço.
  // Sem NAV (ledger fora, PLINARFB circulando) → 503 constante.
  let cotacao;
  try {
    cotacao = await renovarCotacaoParaSwap(quote);
  } catch (err) {
    if (err instanceof NavIndisponivelError) {
      console.error('[swap/build] NAV indisponível', { requestId, motivo: err.motivo });
      throw new ApiError('LEDGER_UNAVAILABLE', 503, NAV_INDISPONIVEL_MENSAGEM);
    }
    throw err;
  }
  const navNaCotacao = cotacao.navPorTokenNaCotacao.toFixed(8);
  const bridgeAmount = quote.toAmount.toFixed(7); // TESOURO pago (perna 1)
  const stellarAmount = cotacao.plinarfAmount.toFixed(7); // PLINARF emitido (perna 2)
  const classe = classeOrDefault(quote.classe);
  assertClasseDisponivel(classe); // N1: Subordinada sem NAV próprio
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
      { memoHash: createHash('sha256').update(`plina:subscricao:${cotacao.id}`).digest() },
    );

    await db.$transaction(async (tx) => {
      const consumed = await tx.quote.updateMany({
        where: { id: cotacao.id, consumedAt: null },
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
        valorBrl: valorLiquidoDaCotacao(quote), // N1: caixa pelo valor LÍQUIDO do fee
        tokens: stellarAmount,
        chave: `subscricao:${cotacao.id}`,
        quoteId: cotacao.id,
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
            quoteId: cotacao.id,
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
      {
        txHash: distRes.hash,
        quoteId: cotacao.id,
        mock: true,
        alreadyExecuted: true,
        plinarfAmount: stellarAmount,
        navPorTokenNaCotacao: navNaCotacao,
      },
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
    memo: `q:${cotacao.id.slice(0, 24)}`,
  });

  // N1 + L1-S1/S3: o build NÃO assina nada pela Plina nem devolve chave pública.
  // O investidor assina o envelope e o /swap/submit valida o XDR contra as
  // chaves do env, só então acrescenta a assinatura do issuer e submete.
  return ok(
    {
      xdr,
      hashHex,
      quoteId: cotacao.id,
      mock: false,
      // Contrato Atlas/Flora: os valores do quote VIGENTE usado no envelope (pode ser o recotado), em
      // string decimal. A confirmação da tela mostra este plinarfAmount, não o da cotação inicial.
      plinarfAmount: stellarAmount,
      navPorTokenNaCotacao: navNaCotacao,
    },
    { requestId },
  );
});
