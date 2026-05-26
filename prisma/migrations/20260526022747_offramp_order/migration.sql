-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAudit" ADD VALUE 'OFFRAMP_CRIADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'OFFRAMP_BURN_ASSINADO';
ALTER TYPE "AcaoAudit" ADD VALUE 'OFFRAMP_PROCESSANDO';

-- CreateTable
CREATE TABLE "OffRampOrder" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "burnXdr" TEXT,
    "burnStellarTxHash" TEXT,
    "fiatInstructionsJson" JSONB,
    "settledAt" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OffRampOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OffRampOrder_quoteId_key" ON "OffRampOrder"("quoteId");

-- CreateIndex
CREATE INDEX "OffRampOrder_investidorId_idx" ON "OffRampOrder"("investidorId");

-- CreateIndex
CREATE INDEX "OffRampOrder_status_idx" ON "OffRampOrder"("status");

-- AddForeignKey
ALTER TABLE "OffRampOrder" ADD CONSTRAINT "OffRampOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffRampOrder" ADD CONSTRAINT "OffRampOrder_investidorId_fkey" FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
