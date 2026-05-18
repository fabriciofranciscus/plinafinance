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

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  buildSwapBridgeForPlinarfXdr,
  preSignWithSecret,
} from '@/lib/stellar/transactions';
import { distribute } from '@/lib/stellar/issuer';
import { buildAsset } from '@/lib/stellar/account';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      quoteId?: string;
      investorPubkey?: string;
      investidorId?: string;
    };
    const { quoteId, investorPubkey, investidorId } = body;
    if (!quoteId || !investorPubkey) {
      return NextResponse.json(
        { error: 'quoteId e investorPubkey obrigatórios' },
        { status: 400 },
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
      return NextResponse.json({ error: 'quote não encontrado' }, { status: 404 });
    }
    if (quote.investidor.publicKey !== investorPubkey) {
      return NextResponse.json(
        { error: 'quote pertence a outro investidor' },
        { status: 403 },
      );
    }
    if (investidorId && quote.investidorId !== investidorId) {
      return NextResponse.json(
        { error: 'investidorId não bate com o quote' },
        { status: 403 },
      );
    }
    if (quote.consumedAt) {
      return NextResponse.json({ error: 'quote já consumido' }, { status: 409 });
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'quote expirado' }, { status: 410 });
    }
    if (!quote.onRampOrder) {
      return NextResponse.json(
        { error: 'onramp ainda não criada — POST /onramp/create primeiro' },
        { status: 409 },
      );
    }
    if (quote.onRampOrder.status !== 'completed') {
      return NextResponse.json(
        {
          error: `onramp em status=${quote.onRampOrder.status}; aguardando settlement TESOURO`,
        },
        { status: 409 },
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
      return NextResponse.json(
        { error: 'Stellar issuer/distributor não configurados' },
        { status: 500 },
      );
    }

    const stellarAmount = quote.toAmount.toFixed(7);

    const instructions = quote.onRampOrder.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    const mock = instructions?.__mock === true;

    if (mock) {
      // Sem TESOURO real na wallet — emissão direta server-side, consumo
      // atômico do quote + audit log marcando mock.
      const distRes = await distribute(
        distributorSecret,
        issuerPubkey,
        investorPubkey,
        stellarAmount,
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
        await tx.eventoAudit.create({
          data: {
            acao: 'SWAP_EXECUTADO',
            operador: 'sandbox-mock',
            investidorId: quote.investidorId,
            stellarTxHash: distRes.hash,
            payloadJson: {
              quoteId: quote.id,
              orderId: quote.onRampOrder?.id,
              amount: stellarAmount,
              mock: true,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return NextResponse.json({
        txHash: distRes.hash,
        mock: true,
        alreadyExecuted: true,
      });
    }

    // Real: envelope atômico com 2 legs.
    const tesouro = await resolveTesouroAsset(investorPubkey);
    const bridgeAsset = buildAsset(tesouro.issuer, tesouro.code);

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
      memo: `q:${quote.id.slice(0, 24)}`,
    });

    // Distributor pré-assina server-side — investor só co-assina o hash.
    const distributorSig = preSignWithSecret(xdr, distributorSecret);

    return NextResponse.json({
      xdr,
      hashHex,
      distributorSigBase64: distributorSig.sigBase64,
      distributorPubkey: distributorSig.pubkey,
      mock: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
