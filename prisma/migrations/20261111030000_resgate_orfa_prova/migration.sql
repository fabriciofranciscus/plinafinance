-- E2-6 (condição de merge do Atlas): resgate órfão com as MESMAS regras do N1 (liberação por tempo só na 2ª varredura,
-- vigia de 24 h, alerta de conflito). Aditiva e idempotente.
ALTER TABLE "ResgateCotacao" ADD COLUMN IF NOT EXISTS "livreExpiradaVistaEm" TIMESTAMP(3);
ALTER TABLE "ResgateCotacao" ADD COLUMN IF NOT EXISTS "liberadaTxHash" TEXT;
ALTER TABLE "ResgateCotacao" ADD COLUMN IF NOT EXISTS "liberadaPorTempoEm" TIMESTAMP(3);
ALTER TABLE "ResgateCotacao" ADD COLUMN IF NOT EXISTS "vigiaConsultadaEm" TIMESTAMP(3);
ALTER TABLE "ResgateCotacao" ADD COLUMN IF NOT EXISTS "conflitoAlertadoEm" TIMESTAMP(3);
