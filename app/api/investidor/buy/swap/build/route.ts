/**
 * POST /api/investidor/buy/swap/build
 *
 * Monta o envelope atômico de emissão de PLINARF — duas legs no mesmo
 * envelope assinado: (1) investor → distributor em TESOURO; (2) distributor
 * → investor em PLINARF. Investor co-assina via Privy; distributor já
 * vem pré-assinado server-side. Submissão em /swap/submit.
 *
 * Pré-condições:
 *   - Quote válido (não expirado, não consumido) e pertencente ao investor.
 *   - OnRampOrder ligada ao quote com status=completed (TESOURO settled).
 *   - Investor tem trustline PLINARF autorizada + trustline TESOURO.
 *
 * Modo mock (PLINA-MOD-005 bypass): quando a order é mock (sandbox sem
 * iframe), não há TESOURO real na wallet — emissão cai num caminho
 * direto (distribute single-shot) executado server-side. Marca audit log.
 *
 * Body: { quoteId, investorPubkey, investidorId? }
 * Returns (real): { xdr, hashHex, distributorSigBase64, mock: false }
 * Returns (mock): { txHash, mock: true, alreadyExecuted: true }
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  buildSwapBridgeForPlinarfXdr,
  preSignWithSigner,
} from '@/lib/stellar/transactions';
import { distribute, createTrustline } from '@/lib/stellar/issuer';
import { distributorSigner } from '@/lib/stellar/signer';
import { mainnetCutoverGuard } from '@/lib/env/feature-gates';
import { buildAsset, loadAccount } from '@/lib/stellar/account';
import { logStellarError } from '@/lib/stellar/log-error';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';
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
  // A validade da cotação FX só é um gate ANTES do pagamento (consumida no
  // /onramp/create). Depois que o TESOURO foi liquidado (onramp completed), a
  // swap é 1:1 NAV e não depende mais da janela do quote — não bloqueia, pra
  // não barrar o settlement/claim/assinatura que levam mais que o TTL.
  const onrampCompleted = quote.onRampOrder?.status === 'completed';
  if (!onrampCompleted && quote.expiresAt.getTime() <= Date.now()) {
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

  const stellarAmount = quote.toAmount.toFixed(7);
  const classe = classeOrDefault(quote.classe);
  const plinarfCode = assetCodeForClasse(classe);

  const instructions = quote.onRampOrder.paymentInstructionsJson as
    | (Record<string, unknown> & { __mock?: boolean })
    | null;
  const mock = instructions?.__mock === true;

  // Defesa em profundidade: uma order mock NUNCA pode emitir PLINARF sem
  // perna TESOURO fora de sandbox (ex.: dados de testnet num DB promovido a
  // mainnet). `distribute()` é free-mint — recusa antes de tocar a chain.
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
    const distRes = await distribute(
      distributorSigner(),
      issuerPubkey,
      investorPubkey,
      stellarAmount,
      plinarfCode,
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

  // Etherfuse devolve toAmount em TESOURO (já fixou via quote). Mesmo valor
  // serve pra leg TESOURO. PLINARF é 1:1 NAV (whitepaper §6.5) então leg
  // PLINARF também usa quote.toAmount.
  const bridgeAmount = stellarAmount;

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

  // Distributor pré-assina server-side — investor só co-assina o hash.
  const distributorSig = preSignWithSigner(distributorSigner(), xdr);

  return ok(
    {
      xdr,
      hashHex,
      distributorSigBase64: distributorSig.sigBase64,
      distributorPubkey: distributorSig.pubkey,
      mock: false,
    },
    { requestId },
  );
});
