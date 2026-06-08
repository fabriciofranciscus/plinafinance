/**
 * Backfill do modelo `Pessoa` a partir dos `Investidor` existentes
 * (migration `add_pessoa_model`). Cria uma Pessoa por Investidor com privyId
 * e liga `Investidor.pessoaId`.
 *
 * Estratégia: pra cada Investidor com `privyId` e sem `pessoaId`, upsert
 * Pessoa por privyId (copia email, nome, publicKey, campos de KYC/Etherfuse,
 * CPF), deriva kycStatus, papeis=[INVESTIDOR]. Rows sem privyId são puladas
 * (seguem funcionando via espelhos; ganham Pessoa no próximo onboarding).
 *
 * Uso:
 *   pnpm tsx scripts/backfill-pessoa.ts          # dry-run (default)
 *   pnpm tsx scripts/backfill-pessoa.ts --apply  # aplica
 */

import 'dotenv/config';
import { PrismaClient, KycStatus, Papel, StatusInvestidor } from '@prisma/client';

const APPLY = process.argv.includes('--apply');

function deriveKycStatus(kycAprovado: boolean, status: StatusInvestidor): KycStatus {
  if (kycAprovado) return KycStatus.APROVADO;
  if (status === StatusInvestidor.PENDENTE_KYC) return KycStatus.PENDENTE;
  return KycStatus.NAO_INICIADO;
}

async function main() {
  const db = new PrismaClient();

  const rows = await db.investidor.findMany({
    where: { privyId: { not: null }, pessoaId: null },
    select: {
      id: true,
      privyId: true,
      email: true,
      nome: true,
      publicKey: true,
      kycAprovado: true,
      status: true,
      etherfuseCustomerId: true,
      etherfuseBankAccountId: true,
      cpfNormalizado: true,
      isSyntheticCpf: true,
    },
  });

  const semPrivy = await db.investidor.count({ where: { privyId: null } });
  console.log(
    `[backfill-pessoa] investidores a migrar: ${rows.length} · sem privyId (skip): ${semPrivy} · apply=${APPLY}`,
  );

  let migrated = 0;
  for (const inv of rows) {
    const privyId = inv.privyId!;
    const kycStatus = deriveKycStatus(inv.kycAprovado, inv.status);
    console.log(`  ${inv.email} (${privyId}) → Pessoa [${kycStatus}]`);
    if (APPLY) {
      await db.$transaction(async (tx) => {
        const pessoa = await tx.pessoa.upsert({
          where: { privyId },
          create: {
            privyId,
            email: inv.email,
            nome: inv.nome,
            publicKey: inv.publicKey,
            kycStatus,
            kycAprovado: inv.kycAprovado,
            etherfuseCustomerId: inv.etherfuseCustomerId,
            etherfuseBankAccountId: inv.etherfuseBankAccountId,
            cpfNormalizado: inv.cpfNormalizado,
            isSyntheticCpf: inv.isSyntheticCpf,
            papeis: [Papel.INVESTIDOR],
          },
          update: {
            papeis: { set: [Papel.INVESTIDOR] },
          },
        });
        await tx.investidor.update({
          where: { id: inv.id },
          data: { pessoaId: pessoa.id },
        });
      });
    }
    migrated++;
  }

  console.log(`\nmigrated=${migrated}`);
  if (!APPLY) console.log('dry-run: rode com --apply pra persistir.');
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
