/**
 * L2 — exporta, para PUBLICAR, os 2 registros canônicos de uma cota: o payload da validação e o registro da incorporação.
 *   pnpm exec tsx scripts/exportar-registros-canonicos.ts <cotaId>
 * Só leitura no banco (a Thais roda com a string de produção, como no COMANDO-EVIDENCIA-COTA.md: worktree temporário, pasta SEM
 * .env.local, histórico do terminal apagado no fim). Só TESTNET. Confere hash = registro = Memo.hash na Horizon e varre dado
 * pessoal ANTES de gravar; se qualquer coisa falhar, o registro não é gerado. Saída: exports/registros-canonicos-<cotaId>/
 * (os arquivos publicáveis + manifesto.json) e uma tabela no terminal sem dado pessoal.
 * Código de saída: 0 = os 2 prontos e conferidos; 1 = algum recusado; 64 = uso errado.
 */
import { carregarEnv } from './lib/carregar-env';

carregarEnv(); // linha de comando > .env.local > .env

async function main() {
  const cotaId = process.argv[2];
  if (!cotaId) {
    console.error('Uso: pnpm exec tsx scripts/exportar-registros-canonicos.ts <cotaId>');
    process.exit(64);
  }
  const { STELLAR_NETWORK, horizonUrl } = await import('../lib/stellar/config');
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('Recusado: a exportação só roda contra TESTNET.');
  const { db } = await import('../lib/db');
  const { exportarRegistros } = await import('./evidencia-cota/exportar');
  const r = await exportarRegistros({ cotaId, db, fetchFn: fetch, horizonUrl, destinoBase: 'exports' });
  await db.$disconnect();
  console.log(`Registros canônicos da cota ${r.cotaId}`);
  for (const l of r.linhas) {
    console.log(
      l.ok
        ? `  ✓ ${l.registro}: ${l.arquivo}  sha256 ${l.sha256}  tx ${l.txHash} (memo confere)`
        : `  ✗ ${l.registro}: RECUSADO — ${l.motivo}`,
    );
  }
  console.log(r.tudoOk ? `\nPRONTO: ${r.pasta}/ (publicar os bytes como estão; conferir sha256 = memo antes de pôr o link)` : '\nNÃO PRONTO: nada foi publicado para os registros recusados.');
  process.exit(r.tudoOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
