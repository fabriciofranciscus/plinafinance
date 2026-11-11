/**
 * Smoke âncora E3-1/DS3 — só TESTNET, distributor DESCARTÁVEL (a chave do
 * projeto é trocada só neste processo; nenhum segredo do projeto é usado).
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-ancora.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { createFundedAccount } from '../lib/stellar/account';
import { STELLAR_NETWORK, txExplorerUrl } from '../lib/stellar/config';

const ok = (m: string) => console.log(`  ✓ ${m}`);

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');
  const dist = await createFundedAccount();
  process.env.STELLAR_DISTRIBUTOR_SECRET = dist.secret();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = dist.publicKey();
  const { ancorarSha256, verificarAncora } = await import('../lib/stellar/ancora');

  const arquivo = JSON.stringify({ tipo: 'snapshot-smoke', id: randomUUID() });
  const sha = createHash('sha256').update(arquivo).digest('hex');
  const a = await ancorarSha256({ sha256Hex: sha, contexto: 'SNAPSHOT_NAV' });
  ok(`âncora — ${txExplorerUrl(a.txHash)} (memo = ${sha})`);
  await new Promise((r) => setTimeout(r, 6000));
  const b = await ancorarSha256({ sha256Hex: sha, contexto: 'SNAPSHOT_NAV' });
  if (!b.reutilizada || b.txHash !== a.txHash) throw new Error('reancorar deveria reutilizar a mesma tx');
  ok('reancorar o mesmo hash reutilizou a tx (sem 2ª âncora)');
  const v = await verificarAncora({ txHash: a.txHash, sha256Hex: sha });
  if (!v.confere) throw new Error(`verificar: ${v.motivo}`);
  const outro = createHash('sha256').update(arquivo + 'x').digest('hex');
  const w = await verificarAncora({ txHash: a.txHash, sha256Hex: outro });
  if (w.confere || w.motivo !== 'MEMO_DIVERGE') throw new Error('arquivo alterado deveria divergir');
  ok('verificarAncora: confere com o arquivo; arquivo alterado → MEMO_DIVERGE');
  console.log('\nOK');
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.message : e); process.exit(1); });
