-- E1-2: Pix de saída ao titular pelo PSP. Aditiva e idempotente (só cria).
DO $$ BEGIN
  CREATE TYPE "StatusTransferenciaPix" AS ENUM ('ENVIANDO', 'PROCESSANDO', 'INCERTO', 'FALHOU', 'COMPROVADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TransferenciaPix" (
  "id" TEXT NOT NULL,
  "cessaoId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "provedor" TEXT NOT NULL,
  "status" "StatusTransferenciaPix" NOT NULL DEFAULT 'ENVIANDO',
  "valor" DECIMAL(15,2) NOT NULL,
  "destinoMascarado" TEXT NOT NULL,
  "providerId" TEXT,
  "e2eId" TEXT,
  "comprovante" TEXT,
  "comprovanteSha256" TEXT,
  "comprovantePath" TEXT,
  "ancoraTxHash" TEXT,
  "motivoFalha" TEXT,
  "travaAte" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransferenciaPix_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TransferenciaPix_cessaoId_key" ON "TransferenciaPix"("cessaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "TransferenciaPix_idempotencyKey_key" ON "TransferenciaPix"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "TransferenciaPix_status_idx" ON "TransferenciaPix"("status");
