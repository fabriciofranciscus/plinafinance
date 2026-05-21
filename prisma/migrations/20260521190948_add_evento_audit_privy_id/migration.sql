-- AlterTable: rastreabilidade individual CVM 175.
ALTER TABLE "EventoAudit" ADD COLUMN "privyId" TEXT;

-- Index pra filtrar audit por sessão.
CREATE INDEX "EventoAudit_privyId_idx" ON "EventoAudit"("privyId");
