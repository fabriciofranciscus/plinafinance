-- E1-2 (varredor): marca de dedupe do alerta de operação. Aditiva e idempotente.
ALTER TABLE "TransferenciaPix" ADD COLUMN IF NOT EXISTS "alertadoEm" TIMESTAMP(3);
