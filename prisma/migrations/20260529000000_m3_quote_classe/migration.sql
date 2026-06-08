-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "classe" "ClassePLINARF";

-- AlterEnum: M3 institutional gating audit actions
ALTER TYPE "AcaoAudit" ADD VALUE 'SUITABILITY_PREENCHIDA';
ALTER TYPE "AcaoAudit" ADD VALUE 'TICKET_MINIMO_REJEITADO';
