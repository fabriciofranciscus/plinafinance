/**
 * Inspeção read-only do ledger de posição. Roda antes/depois de uma
 * liquidação ou clawback pra confirmar que HoldingPLINARF.saldo e
 * Investidor.saldoEsperado decrementam juntos (fix do desync).
 *
 *   DOTENV_CONFIG_PATH=.env.local node --require dotenv/config \
 *     node_modules/tsx/dist/cli.mjs scripts/inspect-holdings.ts
 */
import { db } from '../lib/db';

async function main() {
  const investidores = await db.investidor.findMany({
    select: {
      id: true,
      email: true,
      saldoEsperado: true,
      holdings: { select: { classe: true, saldo: true } },
    },
    orderBy: { criadoEm: 'asc' },
  });

  if (investidores.length === 0) {
    console.log('(nenhum investidor — rode `pnpm prisma:seed`)');
    return;
  }

  for (const inv of investidores) {
    const somaHoldings = inv.holdings.reduce(
      (acc, h) => acc.plus(h.saldo),
      new (inv.saldoEsperado.constructor as typeof import('@prisma/client').Prisma.Decimal)(0),
    );
    const coerente = somaHoldings.equals(inv.saldoEsperado) ? '✓' : '✗ DIVERGE';
    console.log(`\n• ${inv.email} (${inv.id})`);
    console.log(`    saldoEsperado (agregado): ${inv.saldoEsperado.toFixed(7)}`);
    for (const h of inv.holdings) {
      console.log(`    HoldingPLINARF[${h.classe}].saldo: ${h.saldo.toFixed(7)}`);
    }
    if (inv.holdings.length === 0) {
      console.log('    HoldingPLINARF: (nenhuma row — investidor sem swap)');
    }
    console.log(`    Σ holdings vs saldoEsperado: ${coerente}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
