/**
 * POST /api/investidor/liquidar/submit
 *
 * Submete XDR de liquidação assinada pelo investidor via Privy rawSign.
 * Após sucesso on-chain, registra hash de auditoria e decrementa
 * saldoEsperado.
 *
 * Body: { xdr, pubkey, signatureHex, amount, investidorId? }
 */

import { NextResponse } from 'next/server';
import { submitLiquidacao } from '@/lib/services/liquidacao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      xdr?: string;
      pubkey?: string;
      signatureHex?: string;
      amount?: string;
      investidorId?: string;
    };
    if (!body.xdr || !body.pubkey || !body.signatureHex || !body.amount) {
      return NextResponse.json(
        { error: 'xdr, pubkey, signatureHex e amount são obrigatórios' },
        { status: 400 },
      );
    }
    const result = await submitLiquidacao({
      xdr: body.xdr,
      investorPubkey: body.pubkey,
      signatureHex: body.signatureHex,
      amount: body.amount,
      investidorId: body.investidorId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
