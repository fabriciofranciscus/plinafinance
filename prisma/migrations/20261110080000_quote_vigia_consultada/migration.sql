-- N1 (Vera/Farol): a vigia de 24 h passa a consultar em LOTE com rodízio pela última consulta. Aditiva e idempotente.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "vigiaConsultadaEm" TIMESTAMP(3);
