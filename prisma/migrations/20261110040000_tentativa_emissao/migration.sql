-- CreateEnum (idempotente)
DO $$ BEGIN
  CREATE TYPE "StatusTentativaEmissao" AS ENUM ('PENDENTE', 'CONFIRMADA', 'FALHOU', 'EXPIRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TentativaEmissao" (
    "memoHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "maxTime" TIMESTAMP(3) NOT NULL,
    "status" "StatusTentativaEmissao" NOT NULL DEFAULT 'PENDENTE',
    "valorBrl" DECIMAL(20,7) NOT NULL,
    "quantidade" DECIMAL(20,7) NOT NULL,
    "navPorToken" DECIMAL(20,8) NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TentativaEmissao_pkey" PRIMARY KEY ("memoHash")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TentativaEmissao_status_idx" ON "TentativaEmissao"("status");
