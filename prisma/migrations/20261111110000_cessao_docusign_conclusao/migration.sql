-- AlterEnum (idempotente)
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'CESSAO_RECUSADA_DOCUSIGN';

-- AlterTable (aditivo, idempotente)
ALTER TABLE "Cessao" ADD COLUMN IF NOT EXISTS "docusignConclusaoIniciadaEm" TIMESTAMP(3);
