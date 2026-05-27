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
import { z } from 'zod';
import { submitLiquidacao } from '@/lib/services/liquidacao';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import {
  stellarPubkey,
  stellarSignatureHex,
  stellarXdr,
} from '@/lib/http/zod-stellar';

export const dynamic = 'force-dynamic';

// C-03: amount no body é ignorado — amount autoritativo sai da própria XDR
// em submitLiquidacao. Aceito no schema só pra clientes legados não quebrarem.
const Schema = z
  .object({
    xdr: stellarXdr(),
    pubkey: stellarPubkey(),
    signatureHex: stellarSignatureHex(),
    amount: z.string().max(40).optional(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { xdr, pubkey, signatureHex } = parsed.data;
  try {
    if (pubkey !== user.publicKey) {
      return NextResponse.json(
        { error: 'pubkey não corresponde ao investidor autenticado' },
        { status: 403 },
      );
    }
    const result = await submitLiquidacao({
      xdr,
      investorPubkey: pubkey,
      signatureHex,
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
