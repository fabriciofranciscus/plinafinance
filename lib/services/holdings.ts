import { ClassePLINARF, Prisma } from '@prisma/client';

/**
 * F-M3-2. Registra/incrementa a posição do investidor numa classe PLINA-RF
 * (Sênior / Subordinada) após emissão on-chain bem-sucedida. Idempotente por
 * `@@unique([investidorId, classe])`: a primeira emissão grava `emissaoTxHash`,
 * as seguintes só incrementam `saldo`.
 *
 * Deve rodar DENTRO da mesma `$transaction` que consome o quote — o saldo
 * por classe não pode divergir do `Quote.consumedAt`.
 */
export async function incrementarHolding(
  tx: Prisma.TransactionClient,
  input: {
    investidorId: string;
    classe: ClassePLINARF;
    amount: string;
    txHash: string;
  },
): Promise<void> {
  const inc = new Prisma.Decimal(input.amount);
  await tx.holdingPLINARF.upsert({
    where: {
      investidorId_classe: {
        investidorId: input.investidorId,
        classe: input.classe,
      },
    },
    create: {
      investidorId: input.investidorId,
      classe: input.classe,
      saldo: inc,
      emissaoTxHash: input.txHash,
    },
    update: {
      saldo: { increment: inc },
    },
  });
}
