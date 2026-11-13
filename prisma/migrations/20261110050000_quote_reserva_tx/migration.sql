-- N1 (Atlas/Argus): hash da tx e prazo (maxTime) gravados na reserva do swap, para escriturar ou liberar
-- uma reserva órfã sem esperar o investidor. Aditiva e idempotente.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "submitTxHash" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "submitMaxTime" TIMESTAMP(3);
