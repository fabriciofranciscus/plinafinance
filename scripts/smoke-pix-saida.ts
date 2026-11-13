/**
 * Smoke E1-2 — só TESTNET + Neon DEV, provedor SIMULADO (nenhum dinheiro, nenhum PSP). Exercita de verdade: claim no banco,
 * comprovante canônico, Blob privado SEM sobrescrever (2 gravações = ok), âncora do distributor com Memo.hash = SHA-256.
 *   pnpm exec tsx --env-file=<.env.local com DIRECT_URL no DATABASE_URL> scripts/smoke-pix-saida.ts
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { guardarComprovantePsp } from '../lib/integrations/blob/comprovante-psp';
import { criarSimuladoProvider } from '../lib/integrations/psp/simulado';
import { STELLAR_NETWORK, txExplorerUrl } from '../lib/stellar/config';
import { pagarTitular } from '../lib/services/liquidacao-cedente';
import { db } from '../lib/db';

async function main() {
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('smoke só roda em TESTNET');
  const cessaoId = `smoke-${randomUUID().slice(0, 8)}`;
  const p = criarSimuladoProvider();
  const a = await pagarTitular({ cessaoId, valor: '10.00', chavePix: 'smoke@example.com', tipoChave: 'EMAIL' }, { provider: p });
  console.log(`  ✓ ${a.status} · ${a.txHash ? txExplorerUrl(a.txHash) : '-'}\n    sha256: ${a.sha256}`);
  if (a.status !== 'COMPROVADA') throw new Error('deveria comprovar');
  const row = await db.transferenciaPix.findUniqueOrThrow({ where: { cessaoId } });
  if (createHash('sha256').update(Buffer.from(row.comprovante!, 'utf8')).digest('hex') !== a.sha256) throw new Error('hash do comprovante gravado diverge');
  console.log(`  ✓ comprovante gravado confere com o hash; destino ${row.destinoMascarado}; path ${row.comprovantePath}`);
  const b = await pagarTitular({ cessaoId, valor: '10.00', chavePix: 'smoke@example.com', tipoChave: 'EMAIL' }, { provider: p });
  if (b.txHash !== a.txHash || b.sha256 !== a.sha256) throw new Error('2ª chamada deveria devolver o mesmo');
  console.log('  ✓ 2ª chamada: mesmo hash e mesma tx (sem novo envio nem nova âncora)');
  await guardarComprovantePsp({ cessaoId, bytes: Buffer.from(row.comprovante!, 'utf8') });
  console.log('  ✓ Blob: regravar o mesmo comprovante (sem sobrescrever) é tratado como já feito');
  console.log('\nOK');
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? `${e.name}: ${e.message}` : e); process.exit(1); }).finally(() => db.$disconnect());
