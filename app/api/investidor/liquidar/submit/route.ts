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
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = (await req.json()) as {
      xdr?: string;
      pubkey?: string;
      signatureHex?: string;
      amount?: string;
    };
    if (!body.xdr || !body.pubkey || !body.signatureHex) {
      return NextResponse.json(
        { error: 'xdr, pubkey, signatureHex são obrigatórios' },
        { status: 400 },
      );
    }
    if (body.pubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'pubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }
    // C-03: body.amount agora é opcional/ignorado — amount autoritativo
    // sai da própria XDR em submitLiquidacao.
    const result = await submitLiquidacao({
      xdr: body.xdr,
      investorPubkey: body.pubkey,
      signatureHex: body.signatureHex,
      investidorId: user.investidorId,
      privyId: user.privyId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
