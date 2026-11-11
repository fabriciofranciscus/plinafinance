-- AlterEnum (idempotente)
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'CESSAO_ENVIADA_DOCUSIGN';

-- AlterTable (aditivo, idempotente)
ALTER TABLE "Cessao" ADD COLUMN IF NOT EXISTS "docusignEnvioIniciadoEm" TIMESTAMP(3);
