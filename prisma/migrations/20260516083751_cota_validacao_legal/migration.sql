-- AlterEnum
ALTER TYPE "AcaoAudit" ADD VALUE 'COTA_VALIDADA';

-- AlterTable
ALTER TABLE "Cota" ADD COLUMN     "hashValidacao" TEXT,
ADD COLUMN     "validacaoTxHash" TEXT;

