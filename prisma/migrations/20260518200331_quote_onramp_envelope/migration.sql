-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAudit" ADD VALUE 'TESOURO_TRUSTLINE_AUTORIZADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'ONRAMP_CRIADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'ONRAMP_LIQUIDADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'SWAP_EXECUTADO';

-- AlterTable
ALTER TABLE "Investidor" ADD COLUMN     "tesouroTrustlineTxHash" TEXT;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "fromAmount" DECIMAL(20,7) NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "toAmount" DECIMAL(20,7) NOT NULL,
    "exchangeRate" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedTxHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnRampOrder" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stellarTxHash" TEXT,
    "paymentInstructionsJson" JSONB,
    "settledAt" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnRampOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_investidorId_idx" ON "Quote"("investidorId");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- CreateIndex
CREATE INDEX "Quote_consumedAt_idx" ON "Quote"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnRampOrder_quoteId_key" ON "OnRampOrder"("quoteId");

-- CreateIndex
CREATE INDEX "OnRampOrder_investidorId_idx" ON "OnRampOrder"("investidorId");

-- CreateIndex
CREATE INDEX "OnRampOrder_status_idx" ON "OnRampOrder"("status");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_investidorId_fkey" FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnRampOrder" ADD CONSTRAINT "OnRampOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnRampOrder" ADD CONSTRAINT "OnRampOrder_investidorId_fkey" FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
