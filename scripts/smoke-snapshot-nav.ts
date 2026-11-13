/**
 * Smoke E3-1 — só TESTNET, Neon DEV. Publica (ou reutiliza) o snapshot do dia: gates reais, arquivo no Blob,
 * âncora do distributor. Roda 2x: a 2ª tem de ser `reutilizada` com o mesmo hash/tx. Depois o avaliador confere:
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-snapshot-nav.ts
 *   pnpm snapshot:verificar <url impressa>
 */
import { STELLAR_NETWORK, txExplorerUrl } from '../lib/stellar/config';
import { SnapshotNavError, publicarSnapshotNav } from '../lib/services/snapshot-nav';

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');
  let a;
  try {
    a = await publicarSnapshotNav();
  } catch (e) {
    if (e instanceof SnapshotNavError) {
      console.log(`GATE/FALHA: ${e.code}${e.causa ? ` (${e.causa})` : ''} — nada foi publicado nem ancorado`);
      process.exit(3);
    }
    throw e;
  }
  console.log(`  ✓ ${a.reutilizada ? 'reutilizado' : 'publicado'} ${a.data} · NAV/token ${a.navPorToken}`);
  console.log(`    arquivo: ${a.url}\n    sha256:  ${a.sha256}\n    âncora:  ${txExplorerUrl(a.txHash)}`);
  const b = await publicarSnapshotNav();
  if (!b.reutilizada || b.txHash !== a.txHash || b.sha256 !== a.sha256) throw new Error('2ª chamada deveria reutilizar');
  console.log('  ✓ 2ª chamada no mesmo dia: reutilizada, mesmo hash e mesma tx');
  console.log('\nOK');
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.name : e); process.exit(1); });
