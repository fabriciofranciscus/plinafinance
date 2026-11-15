/**
 * POST /api/investidor/buy/claim/build
 *
 * PLINA-MOD-007: monta tx de `claimClaimableBalance` pra investor resgatar
 * o TESOURO emitido pela Etherfuse pós-onramp. Sem esse claim, balance
 * fica em CB pendente e o off-ramp burn falha (op_underfunded).
 *
 * O setup do investidor NÃO abre a trustline TESOURO (E2-3: a reserva só quando precisa). Por isso o envelope leva, no MESMO XDR e
 * ANTES do claim, o `changeTrust` do TESOURO quando a carteira ainda não tem a trustline (1 assinatura do investidor; sem
 * trustline não há `op_no_trust`). Com a trustline já aberta, o envelope é só o claim. Via `prepararClaimXdr`.
 *
 * Pré-req: OnRampOrder.stellarClaimableBalanceId preenchido (vem do
 * /onramp/sandbox-pay quando status flippa pra completed).
 *
 * Body: { orderId }
 * Returns: { xdr, hashHex, balanceId, operacoes }  (operacoes: ['changeTrust','claimClaimableBalance'] ou só o claim)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { ClaimError, prepararClaimXdr } from '@/lib/stellar/claim';
import { internalErrorResponse } from '@/lib/api/internal-error';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({ orderId: z.string().min(1).max(60) })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { orderId } = parsed.data;
  try {
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

    const claim = await prepararClaimXdr({
      investorPubkey: user.publicKey,
      balanceId: order.stellarClaimableBalanceId,
    });

    return NextResponse.json({
      xdr: claim.xdr,
      hashHex: claim.hashHex,
      balanceId: order.stellarClaimableBalanceId,
      operacoes: claim.operacoes,
    });
  } catch (err) {
    // Erros tipados do claim (mensagem fixa e code; sem segredo nem env).
    if (err instanceof ClaimError) {
      const status = err.code === 'NOT_CLAIMANT' ? 403 : 409;
      return NextResponse.json(
        { error: err.message, code: err.code, ...(err.aporteXlm ? { aporteXlm: err.aporteXlm } : {}) },
        { status },
      );
    }
    return internalErrorResponse(err, 'claim/build');
  }
});
