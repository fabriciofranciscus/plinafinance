-- N1 (Argus a): a liberação por TEMPO só vale na 2ª varredura seguida que vê a sequence livre depois do prazo.
-- Guarda quando a 1ª varredura viu. Aditiva e idempotente.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "livreExpiradaVistaEm" TIMESTAMP(3);
-- Dedupe do alerta de conflito da vigia de 24 h (um e-mail por quote).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "conflitoAlertadoEm" TIMESTAMP(3);
