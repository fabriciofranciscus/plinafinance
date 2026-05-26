-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAudit" ADD VALUE 'BANK_ACCOUNT_REGISTRADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'CLAIMABLE_BALANCE_RESGATADA';

-- AlterTable
ALTER TABLE "Investidor" ADD COLUMN     "etherfuseBankAccountId" TEXT;

-- AlterTable
ALTER TABLE "OnRampOrder" ADD COLUMN     "claimTxHash" TEXT,
ADD COLUMN     "stellarClaimableBalanceId" TEXT;
