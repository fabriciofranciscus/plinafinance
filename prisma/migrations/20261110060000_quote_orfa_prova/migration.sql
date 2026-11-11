-- N1 (Atlas/Argus, mitigação de disponibilidade): o envelope do swap reservado (assinado SÓ pelo investidor, sem
-- assinatura da Plina) fica guardado para provar o desfecho pela conta do investidor; e o hash liberado por TEMPO
-- entra numa vigia de 24 h. Aditiva e idempotente.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "submitXdr" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "liberadaTxHash" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "liberadaPorTempoEm" TIMESTAMP(3);
