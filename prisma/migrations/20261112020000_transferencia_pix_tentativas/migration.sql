-- E1-2 (F-E12-1): reabrir um Pix FALHOU com nova tentativa auditada. Aditiva e idempotente.
ALTER TABLE "TransferenciaPix" ADD COLUMN IF NOT EXISTS "tentativa" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TransferenciaPix" ADD COLUMN IF NOT EXISTS "historico" JSONB;
