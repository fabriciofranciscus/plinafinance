/**
 * E2 — verificador do aceite do swap (2.2/2.3): `pnpm evidencia:swap <txHash> [--issuer G…] [--distributor G…]`.
 * Lê a tx no Horizon (só leitura, TESTNET) e confere 1 envelope bem-sucedido com as 2 pernas:
 *   ENTRADA: TESOURO investidor → distributor + PLINA-RF issuer → investidor (emissão)
 *   SAÍDA:   PLINA-RF investidor → issuer (queima) + TESOURO distributor → investidor
 * As contas vêm dos argumentos ou, na falta, de STELLAR_ISSUER_PUBLIC / STELLAR_DISTRIBUTOR_PUBLIC (só públicas).
 * Não usa banco nem segredo. Saída: 0 confere · 1 não confere · 64 uso. Imprime o link do Stellar Expert.
 */
import { StrKey } from '@stellar/stellar-sdk';
import { classificarSwap, type OpLida } from './evidencia-swap/core';

const HORIZON = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const txHash = process.argv[2];
  if (!txHash || !/^[0-9a-f]{64}$/.test(txHash)) {
    console.error('Uso: pnpm evidencia:swap <txHash 64 hex> [--issuer G…] [--distributor G…] [--bridge TESOURO]');
    process.exit(64);
  }
  if ((process.env.STELLAR_NETWORK ?? 'TESTNET') !== 'TESTNET') throw new Error('Recusado: evidência só em TESTNET.');
  const issuer = arg('--issuer') ?? process.env.STELLAR_ISSUER_PUBLIC?.trim() ?? '';
  const distributor = arg('--distributor') ?? process.env.STELLAR_DISTRIBUTOR_PUBLIC?.trim() ?? '';
  if (!StrKey.isValidEd25519PublicKey(issuer) || !StrKey.isValidEd25519PublicKey(distributor)) {
    console.error('Contas inválidas: informe --issuer e --distributor (chaves públicas G…).');
    process.exit(64);
  }
  const bridgeCode = arg('--bridge') ?? 'TESOURO';

  const t = await fetch(`${HORIZON}/transactions/${txHash}`);
  if (t.status === 404) {
    console.log(`NÃO CONFERE: tx ${txHash} não existe na TESTNET.`);
    process.exit(1);
  }
  if (!t.ok) throw new Error(`Horizon ${t.status} ao ler a tx`);
  const tj = (await t.json()) as { successful: boolean; source_account: string; created_at: string; ledger: number };
  const o = await fetch(`${HORIZON}/transactions/${txHash}/operations?limit=200`);
  if (!o.ok) throw new Error(`Horizon ${o.status} ao ler as operações`);
  const oj = (await o.json()) as {
    _embedded: { records: { type: string; asset_type?: string; asset_code?: string; asset_issuer?: string; from?: string; to?: string; amount?: string; source_account?: string }[] };
  };
  const ops: OpLida[] = oj._embedded.records.map((r) => ({
    type: r.type,
    asset: r.asset_type === 'native' ? 'native' : `${r.asset_code}:${r.asset_issuer}`,
    from: r.from ?? '',
    to: r.to ?? '',
    amount: r.amount ?? '',
    source: r.source_account ?? tj.source_account,
  }));

  const r = classificarSwap({ sucesso: tj.successful === true, ops }, { issuer, distributor, bridgeCode });
  const link = `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  console.log(`# Evidência de swap E2 — ${txHash}`);
  console.log(`Rede: TESTNET · ledger ${tj.ledger} · ${tj.created_at} · ${link}`);
  console.log(`Issuer ${issuer} · distributor ${distributor}`);
  for (const op of ops) console.log(`  ${op.type} ${op.amount} ${op.asset.split(':')[0]}: ${op.from} → ${op.to}`);
  if (r.confere) {
    console.log(`CONFERE: ${r.tipo === 'ENTRADA' ? 'ENTRADA (subscrição: TESOURO → distributor; emissão de' : 'SAÍDA (resgate: queima de'} ${r.plinarf} ${r.classe}${r.tipo === 'ENTRADA' ? ' pelo issuer)' : ' no issuer; TESOURO do distributor)'} · ${r.tesouro} ${r.ativoPonte.split(':')[0]} · investidor ${r.investidor} · 1 envelope, 2 pernas.`);
    process.exit(0);
  }
  console.log(`NÃO CONFERE: ${r.motivo}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
