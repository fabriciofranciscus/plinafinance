-- E1-4 (mesma sequence): sequence da tx de cada tentativa. Aditiva e idempotente.
ALTER TABLE "TentativaEmissao" ADD COLUMN IF NOT EXISTS "sequence" TEXT;
