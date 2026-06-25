import { ClassePLINARF, Prisma } from '@prisma/client';
import { logStellarError } from '../stellar/log-error';

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

/**
 * Espelho de {@link incrementarHolding} pras saídas de token (liquidação,
 * clawback). Decrementa a posição da classe e mantém o ledger por-classe
 * coerente com `Investidor.saldoEsperado`.
 *
 * DEVE rodar DENTRO da mesma `$transaction` que decrementa `saldoEsperado`.
 *
 * **Clamp-to-zero, nunca lança:** este decremento roda DEPOIS da operação
 * on-chain irreversível (o payment/clawback já foi submetido ao Horizon).
 * Lançar aqui falharia a request com a chain já movida — e travaria o retry
 * idempotente. Então: se a row não existe ou o saldo ficaria negativo,
 * loga (sinal de drift, alvo da futura reconciliação Horizon) e segue,
 * gravando no máximo 0.
 */
export async function decrementarHolding(
  tx: Prisma.TransactionClient,
  input: {
    investidorId: string;
    classe: ClassePLINARF;
    amount: string;
    txHash?: string;
  },
): Promise<void> {
  const dec = new Prisma.Decimal(input.amount);
  const existing = await tx.holdingPLINARF.findUnique({
    where: {
      investidorId_classe: {
        investidorId: input.investidorId,
        classe: input.classe,
      },
    },
    select: { saldo: true },
  });

  if (!existing) {
    // Sem row: nada a debitar. Legado pré-holdings ou drift — sinaliza, não derruba.
    logStellarError(
      '[holdings] decrement sem holding existente',
      new Error(
        `investidor=${input.investidorId} classe=${input.classe} amount=${input.amount} tx=${input.txHash ?? '-'}`,
      ),
    );
    return;
  }

  const novo = existing.saldo.sub(dec);
  if (novo.isNegative()) {
    logStellarError(
      '[holdings] decrement underflow (clamp p/ 0)',
      new Error(
        `investidor=${input.investidorId} classe=${input.classe} saldo=${existing.saldo.toString()} amount=${input.amount} tx=${input.txHash ?? '-'}`,
      ),
    );
  }

  await tx.holdingPLINARF.update({
    where: {
      investidorId_classe: {
        investidorId: input.investidorId,
        classe: input.classe,
      },
    },
    data: { saldo: novo.isNegative() ? new Prisma.Decimal(0) : novo },
  });
}
