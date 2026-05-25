/**
 * POST /api/investidor/buy/onramp/create
 *
 * Cria uma order de onramp BRL → TESOURO na Etherfuse, persistida como
 * `OnRampOrder` no DB e atada ao `Quote` (1:1). PIX instructions são
 * devolvidas pro investor pagar off-chain.
 *
 * Quando a Etherfuse rejeita por "Proxy account not found" (PLINA-MOD-005:
 * sandbox sem bank account ativa via iframe), e `ETHERFUSE_ENV=sandbox`,
 * caímos no caminho **mock**: persistimos a order com PIX fake e marcamos
 * `__mock: true` no JSON. /sandbox-pay e /swap/build conhecem esse flag.
 *
 * Body: { quoteId }
 * Returns: { orderId, status, paymentInstructions, mock }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { AnchorError } from '@/lib/anchors/types';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

const MOCK_PIX_KEY = 'plina-sandbox@mock.local';

function isBankAccountMissingError(err: unknown): boolean {
  if (!(err instanceof AnchorError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('proxy account') || msg.includes('bank account');
}

export const POST = withAuth(async (req, { user }) => {
  try {
    const { quoteId } = (await req.json()) as { quoteId?: string };
    if (!quoteId) {
      return NextResponse.json(
        { error: 'quoteId obrigatório' },
        { status: 400 },
      );
    }

    const quote = await db.quote.findUnique({
      where: { id: quoteId },
      include: { investidor: true, onRampOrder: true },
    });
    if (!quote) {
      return NextResponse.json({ error: 'quote não encontrado' }, { status: 404 });
    }
    if (quote.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'quote não pertence ao investidor autenticado' },
        { status: 403 },
      );
    }
    if (quote.consumedAt) {
      return NextResponse.json({ error: 'quote já consumido' }, { status: 409 });
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'quote expirado' }, { status: 410 });
    }
    if (quote.onRampOrder) {
      // Idempotência: order já existe pra esse quote, devolve.
      const instructions = quote.onRampOrder.paymentInstructionsJson as
        | (Record<string, unknown> & { __mock?: boolean })
        | null;
      return NextResponse.json({
        orderId: quote.onRampOrder.id,
        status: quote.onRampOrder.status,
        paymentInstructions: instructions,
        mock: instructions?.__mock === true,
      });
    }
    if (!quote.investidor.etherfuseCustomerId) {
      return NextResponse.json(
        { error: 'investidor sem etherfuseCustomerId — refaça onboarding' },
        { status: 409 },
      );
    }

    const apiKey = process.env.ETHERFUSE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ETHERFUSE_API_KEY ausente' },
        { status: 500 },
      );
    }
    const env = process.env.ETHERFUSE_ENV ?? 'sandbox';
    const anchor = new EtherfuseClient({
      apiKey,
      baseUrl:
        process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
    });

    let orderId: string;
    let status: string;
    let paymentInstructionsJson: Prisma.InputJsonValue;
    let mock = false;

    try {
      const order = await anchor.createOnRamp({
        customerId: quote.investidor.etherfuseCustomerId,
        quoteId: quote.id,
        stellarAddress: quote.investidor.publicKey,
        fromCurrency: quote.fromCurrency,
        toCurrency: quote.toCurrency,
        amount: quote.fromAmount.toFixed(2),
      });
      orderId = order.id;
      status = order.status;
      paymentInstructionsJson = (order.paymentInstructions ?? {}) as Prisma.InputJsonValue;
    } catch (err) {
      if (env === 'sandbox' && isBankAccountMissingError(err)) {
        // PLINA-MOD-005: bank account PIX exige iframe Etherfuse, indisponível
        // em testes programáticos. Mock só pra desbloquear E2E sandbox.
        orderId = `mock-${crypto.randomUUID()}`;
        status = 'pending';
        paymentInstructionsJson = {
          __mock: true,
          type: 'pix',
          pixCode: MOCK_PIX_KEY,
          pixKey: MOCK_PIX_KEY,
          pixKeyType: 'email',
          beneficiary: 'Plina Sandbox (mock)',
          amount: quote.fromAmount.toFixed(2),
          currency: 'BRL',
        };
        mock = true;
      } else {
        throw err;
      }
    }

    await db.$transaction(async (tx) => {
      await tx.onRampOrder.create({
        data: {
          id: orderId,
          quoteId: quote.id,
          investidorId: quote.investidorId,
          status,
          paymentInstructionsJson,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'ONRAMP_CRIADA',
          operador: 'investidor-self-service',
          investidorId: quote.investidorId,
          privyId: user.privyId,
          payloadJson: {
            orderId,
            quoteId: quote.id,
            mock,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({
      orderId,
      status,
      paymentInstructions: paymentInstructionsJson,
      mock,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
