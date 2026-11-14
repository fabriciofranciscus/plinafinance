-- E2-6 (Vera F3): ResgateCotacao.investidorId passa a ter FK para Investidor (sem isso sobram linhas ao apagar o
-- investidor e TRUNCATE ... CASCADE não as limpa). Aditiva e idempotente (a tabela é nova, sem linhas órfãs esperadas).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ResgateCotacao_investidorId_fkey') THEN
    ALTER TABLE "ResgateCotacao"
      ADD CONSTRAINT "ResgateCotacao_investidorId_fkey"
      FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
