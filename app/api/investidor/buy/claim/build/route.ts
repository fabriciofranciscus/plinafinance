/**
 * POST /api/investidor/buy/claim/build
 *
 * PLINA-MOD-007: monta tx de `claimClaimableBalance` pra investor resgatar
 * o TESOURO emitido pela Etherfuse pós-onramp. Sem esse claim, balance
 * fica em CB pendente e o off-ramp burn falha (op_underfunded).
 *
 * Pré-req: OnRampOrder.stellarClaimableBalanceId preenchido (vem do
 * /onramp/sandbox-pay quando status flippa pra completed).
 *
 * Body: { orderId }
 * Returns: { xdr, hashHex, balanceId }
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/wallet/auth-guard';
import { buildClaimClaimableBalanceXdr } from '@/lib/stellar/transactions';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const { orderId } = (await req.json()) as { orderId?: string };
    if (!orderId) {
      return NextResponse.json({ error: 'orderId obrigatório' }, { status: 400 });
    }

    const order = await db.onRampOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'order não encontrada' }, { status: 404 });
    }
    if (order.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'order não pertence ao investidor autenticado' },
        { status: 403 },
      );
    }
    if (!order.stellarClaimableBalanceId) {
      return NextResponse.json(
        {
          error:
            'order sem stellarClaimableBalanceId — onramp ainda não completou ou anchor não emitiu CB',
        },
        { status: 409 },
      );
    }

    const { xdr, hashHex } = await buildClaimClaimableBalanceXdr({
      investorPubkey: user.publicKey,
      balanceId: order.stellarClaimableBalanceId,
    });

    return NextResponse.json({
      xdr,
      hashHex,
      balanceId: order.stellarClaimableBalanceId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
