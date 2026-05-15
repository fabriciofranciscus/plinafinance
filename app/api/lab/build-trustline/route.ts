/**
 * POST /api/lab/build-trustline
 *
 * Smoke endpoint pro /lab. Recebe `{pubkey}`, monta XDR de changeTrust pra
 * PLINARF, devolve `{xdr, hashHex}` pro frontend assinar via Privy rawSign.
 *
 * Não valida JWT do Privy aqui — é smoke; em produção o `verifyPrivyTokenAndExtract`
 * é chamado e a pubkey vem do token, não do body.
 */

import { NextResponse } from 'next/server';
import { buildTrustlineXdr } from '@/lib/stellar/transactions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { pubkey } = (await req.json()) as { pubkey?: string };
    if (!pubkey || !pubkey.startsWith('G')) {
      return NextResponse.json({ error: 'pubkey inválida' }, { status: 400 });
    }
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    if (!issuerPubkey) {
      return NextResponse.json(
        { error: 'STELLAR_ISSUER_PUBLIC não configurado' },
        { status: 500 },
      );
    }
    const result = await buildTrustlineXdr(pubkey, issuerPubkey);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
