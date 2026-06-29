-- CreateEnum
CREATE TYPE "LeadEoiStatus" AS ENUM ('NOVO', 'CONTATADO', 'CONVERTIDO', 'PERDIDO');

-- CreateTable
CREATE TABLE "LeadEoi" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "org" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "perfil" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "ticket" TEXT NOT NULL,
    "currency" TEXT,
    "classe" TEXT,
    "timeline" TEXT,
    "notes" TEXT,
    "status" "LeadEoiStatus" NOT NULL DEFAULT 'NOVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadEoi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadEoi_email_key" ON "LeadEoi"("email");

-- CreateIndex
CREATE INDEX "LeadEoi_status_idx" ON "LeadEoi"("status");

-- CreateIndex
CREATE INDEX "LeadEoi_criadoEm_idx" ON "LeadEoi"("criadoEm");
