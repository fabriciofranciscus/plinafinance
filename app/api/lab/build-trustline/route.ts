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
import { fundAccountIfNeeded } from '@/lib/stellar/account';

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

    // Privy wallets nascem sem XLM (só no MPC custody). Funda via friendbot
    // se a conta não existe on-chain ainda. No-op silencioso pra contas
    // existentes.
    const fundResult = await fundAccountIfNeeded(pubkey);

    const { xdr, hashHex } = await buildTrustlineXdr(pubkey, issuerPubkey);
    return NextResponse.json({ xdr, hashHex, funded: fundResult.funded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
