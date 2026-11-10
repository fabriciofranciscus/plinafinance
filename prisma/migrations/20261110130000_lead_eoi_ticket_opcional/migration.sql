-- LD0: tíquete deixa de ser obrigatório no LeadEoi (sondagem de demanda, sem oferta).
-- Aditiva e idempotente: DROP NOT NULL numa coluna já anulável não faz nada.
ALTER TABLE "LeadEoi" ALTER COLUMN "ticket" DROP NOT NULL;
