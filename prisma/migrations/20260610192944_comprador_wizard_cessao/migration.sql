-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAudit" ADD VALUE 'KYC_COMPRADOR';
ALTER TYPE "AcaoAudit" ADD VALUE 'CESSAO_COMPRADOR_ASSINADA';

-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'COMPRADOR';

-- AlterTable
ALTER TABLE "EventoAudit" ADD COLUMN     "cessaoCompradorId" TEXT;

-- AlterTable
ALTER TABLE "LeadComprador" ADD COLUMN     "pessoaId" TEXT;

-- CreateTable
CREATE TABLE "CessaoComprador" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "docusignEnvelopeId" TEXT,
    "hashDocumento" TEXT,
    "onChainTxHash" TEXT,
    "assinadaEm" TIMESTAMP(3),
    "status" "CessaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CessaoComprador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CessaoComprador_reservaId_key" ON "CessaoComprador"("reservaId");

-- CreateIndex
CREATE INDEX "CessaoComprador_status_idx" ON "CessaoComprador"("status");

-- CreateIndex
CREATE INDEX "CessaoComprador_pessoaId_idx" ON "CessaoComprador"("pessoaId");

-- CreateIndex
CREATE INDEX "EventoAudit_cessaoCompradorId_idx" ON "EventoAudit"("cessaoCompradorId");

-- CreateIndex
CREATE INDEX "LeadComprador_pessoaId_idx" ON "LeadComprador"("pessoaId");

-- AddForeignKey
ALTER TABLE "LeadComprador" ADD CONSTRAINT "LeadComprador_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CessaoComprador" ADD CONSTRAINT "CessaoComprador_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CessaoComprador" ADD CONSTRAINT "CessaoComprador_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_cessaoCompradorId_fkey" FOREIGN KEY ("cessaoCompradorId") REFERENCES "CessaoComprador"("id") ON DELETE SET NULL ON UPDATE CASCADE;
