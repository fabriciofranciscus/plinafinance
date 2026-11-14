-- E2-6 (contrato 2026-11-11-e2-4-resgate-api): cotação do resgate com queima, persistida. Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS "ResgateCotacao" (
    "id" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "classe" "ClassePLINARF" NOT NULL DEFAULT 'SENIOR',
    "plinarfAmount" DECIMAL(20,7) NOT NULL,
    "brlEquivalente" DECIMAL(20,2) NOT NULL,
    "bridgeAmount" DECIMAL(20,7) NOT NULL,
    "taxaBridge" TEXT NOT NULL,
    "bridgeCode" TEXT NOT NULL,
    "bridgeIssuer" TEXT NOT NULL,
    "navPorTokenNaCotacao" DECIMAL(20,8) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submitXdrHash" TEXT,
    "submitTxHash" TEXT,
    "submitMaxTime" TIMESTAMP(3),
    "submitXdr" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedTxHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResgateCotacao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResgateCotacao_submitXdrHash_key" ON "ResgateCotacao"("submitXdrHash");
CREATE INDEX IF NOT EXISTS "ResgateCotacao_investidorId_idx" ON "ResgateCotacao"("investidorId");
CREATE INDEX IF NOT EXISTS "ResgateCotacao_expiresAt_idx" ON "ResgateCotacao"("expiresAt");
