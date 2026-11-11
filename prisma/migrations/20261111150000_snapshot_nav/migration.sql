-- E3-1: snapshot diário do NAV. Aditiva e idempotente (só cria; nada é alterado nem apagado).
DO $$ BEGIN
  CREATE TYPE "StatusSnapshotNav" AS ENUM ('PUBLICANDO', 'PUBLICADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SnapshotNav" (
  "id" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "status" "StatusSnapshotNav" NOT NULL DEFAULT 'PUBLICANDO',
  "conteudo" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "navPorToken" DECIMAL(20,8) NOT NULL,
  "ledger" INTEGER NOT NULL,
  "url" TEXT,
  "txHash" TEXT,
  "travaAte" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publicadoEm" TIMESTAMP(3),
  CONSTRAINT "SnapshotNav_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotNav_data_key" ON "SnapshotNav"("data");
CREATE INDEX IF NOT EXISTS "SnapshotNav_status_idx" ON "SnapshotNav"("status");
