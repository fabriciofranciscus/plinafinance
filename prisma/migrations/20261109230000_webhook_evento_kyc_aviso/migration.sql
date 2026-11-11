-- AlterEnum
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'KYC_ATUALIZADO_WEBHOOK';

-- AlterTable
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "kycUserMessage" TEXT;
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "kycNeedsWork" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebhookEvento" (
    "id" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "recursoId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "erro" TEXT,

    CONSTRAINT "WebhookEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvento_fornecedor_eventoId_key" ON "WebhookEvento"("fornecedor", "eventoId");
CREATE INDEX IF NOT EXISTS "WebhookEvento_fornecedor_tipo_recebidoEm_idx" ON "WebhookEvento"("fornecedor", "tipo", "recebidoEm");
