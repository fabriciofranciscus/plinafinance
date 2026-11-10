-- LD0: tíquete deixa de ser obrigatório no LeadEoi (sondagem de demanda, sem oferta).
-- Aditiva e idempotente: a coluna era NOT NULL; DROP NOT NULL é seguro de repetir (se já for
-- anulável, não faz nada). Não reverter com SET NOT NULL: falha se já houver linha com ticket nulo.
ALTER TABLE "LeadEoi" ALTER COLUMN "ticket" DROP NOT NULL;
