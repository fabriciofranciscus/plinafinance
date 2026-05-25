-- AlterTable: add Investidor.privyId (nullable; backfill via scripts/backfill-privy-id.ts).
ALTER TABLE "Investidor" ADD COLUMN "privyId" TEXT;

-- CreateIndex: unique pra usar como chave de lookup no auth-guard.
CREATE UNIQUE INDEX "Investidor_privyId_key" ON "Investidor"("privyId");
