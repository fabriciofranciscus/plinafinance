-- AlterEnum
ALTER TYPE "AcaoAudit" ADD VALUE 'KYC_DOCUMENTOS_ENVIADOS';

-- AlterTable
ALTER TABLE "Pessoa" ADD COLUMN     "kycDocumentosEnviadosEm" TIMESTAMP(3);
