-- E1-4 (parecer da Consuelo): marca de domínio aplicado e histórico das tentativas.
-- Aditiva e idempotente.
ALTER TABLE "TentativaEmissao" ADD COLUMN IF NOT EXISTS "aplicadaEm" TIMESTAMP(3);
ALTER TABLE "TentativaEmissao" ADD COLUMN IF NOT EXISTS "historico" JSONB NOT NULL DEFAULT '[]';
