/**
 * Backfill `Investidor.privyId` em rows criadas antes da migration
 * `20260521163019_add_investidor_privy_id`.
 *
 * Estratégia: pra cada Investidor com privyId NULL, resolver via Privy por
 * email (`privy.getUserByEmail`). Rows não-resolvidas são ignoradas com log;
 * o owner pode rodar o onboarding de novo, que persiste o privyId no upsert.
 *
 * Uso:
 *   pnpm tsx scripts/backfill-privy-id.ts          # dry-run (default)
 *   pnpm tsx scripts/backfill-privy-id.ts --apply  # aplica
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getPrivyClient } from '../lib/wallet/privy';

const APPLY = process.argv.includes('--apply');

async function main() {
  const db = new PrismaClient();
  const privy = getPrivyClient();

  const rows = await db.investidor.findMany({
    where: { privyId: null },
    select: { id: true, email: true },
  });
  console.log(
    `[backfill-privy-id] rows sem privyId: ${rows.length} (apply=${APPLY})`,
  );

  let resolved = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const user = await privy.getUserByEmail(row.email);
      if (!user?.id) {
        console.warn(`  skip ${row.email} — sem user no Privy`);
        skipped++;
        continue;
      }
      console.log(`  ${row.email} → ${user.id}`);
      if (APPLY) {
        await db.investidor.update({
          where: { id: row.id },
          data: { privyId: user.id },
        });
      }
      resolved++;
    } catch (err) {
      console.warn(
        `  skip ${row.email} — erro:`,
        err instanceof Error ? err.message : err,
      );
      skipped++;
    }
  }

  console.log(`\nresolved=${resolved} skipped=${skipped}`);
  if (!APPLY) console.log('dry-run: rode com --apply pra persistir.');
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
