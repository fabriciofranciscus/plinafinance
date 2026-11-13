-- E1-2: titular confirmado no laudo (HMAC do documento + situação). Aditiva e idempotente; nunca o documento em claro.
ALTER TABLE "Cessao" ADD COLUMN IF NOT EXISTS "titularDocHmac" TEXT;
ALTER TABLE "Cessao" ADD COLUMN IF NOT EXISTS "titularSituacao" TEXT;
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'TITULAR_LAUDO_CONFIRMADO';
