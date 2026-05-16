-- CreateEnum
CREATE TYPE "LeadVendedorStatus" AS ENUM ('NOVO', 'CONTATADO', 'DOCS_SOLICITADOS', 'DOCS_RECEBIDOS', 'OFERTA_ENVIADA', 'OFERTA_ACEITA', 'CESSAO_ASSINADA', 'PIX_EXECUTADO', 'COTA_INCORPORADA', 'PERDIDO');

-- CreateEnum
CREATE TYPE "OfertaStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'ACEITA', 'REJEITADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "CessaoStatus" AS ENUM ('PENDENTE', 'ENVIADA_DOCUSIGN', 'ASSINADA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PagamentoStatus" AS ENUM ('PENDENTE', 'EXECUTADO', 'FALHOU');

-- CreateEnum
CREATE TYPE "PagamentoMetodo" AS ENUM ('PIX_SIMULADO', 'PIX_REAL');

-- CreateEnum
CREATE TYPE "LeadCompradorTipo" AS ENUM ('PESSOA_FISICA', 'PESSOA_JURIDICA');

-- CreateEnum
CREATE TYPE "LeadCompradorStatus" AS ENUM ('NOVO', 'QUALIFICADO', 'RESERVOU', 'FECHOU', 'PERDIDO');

-- CreateEnum
CREATE TYPE "ReservaStatus" AS ENUM ('ATIVA', 'EXPIRADA', 'CONFIRMADA', 'CANCELADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAudit" ADD VALUE 'LEAD_VENDEDOR_CAPTURADO';
ALTER TYPE "AcaoAudit" ADD VALUE 'OFERTA_GERADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'OFERTA_ACEITA';
ALTER TYPE "AcaoAudit" ADD VALUE 'CESSAO_ASSINADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'PIX_SIMULADO_EXECUTADO';
ALTER TYPE "AcaoAudit" ADD VALUE 'LEAD_COMPRADOR_CAPTURADO';
ALTER TYPE "AcaoAudit" ADD VALUE 'RESERVA_CRIADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'RESERVA_EXPIRADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'CAMINHO_A_EXECUTADO';
ALTER TYPE "AcaoAudit" ADD VALUE 'PLINARF_LIQUIDADO';

-- AlterTable
ALTER TABLE "Cota" ADD COLUMN     "cessaoId" TEXT;

-- AlterTable
ALTER TABLE "EventoAudit" ADD COLUMN     "cessaoId" TEXT,
ADD COLUMN     "leadCompradorId" TEXT,
ADD COLUMN     "leadVendedorId" TEXT,
ADD COLUMN     "ofertaId" TEXT,
ADD COLUMN     "payloadHash" TEXT;

-- CreateTable
CREATE TABLE "LeadVendedor" (
    "id" TEXT NOT NULL,
    "origem" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "cpf" TEXT,
    "status" "LeadVendedorStatus" NOT NULL DEFAULT 'NOVO',
    "motivoPerda" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadVendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oferta" (
    "id" TEXT NOT NULL,
    "leadVendedorId" TEXT NOT NULL,
    "tipoBem" "TipoBem" NOT NULL,
    "valorCarta" DECIMAL(15,2) NOT NULL,
    "administradora" TEXT NOT NULL,
    "desagioAquisicao" DECIMAL(5,4) NOT NULL,
    "valorLiquidoVendedor" DECIMAL(15,2) NOT NULL,
    "prazoRestanteMeses" INTEGER,
    "validade" TIMESTAMP(3) NOT NULL,
    "status" "OfertaStatus" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oferta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cessao" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "docusignEnvelopeId" TEXT,
    "hashDocumento" TEXT,
    "onChainTxHash" TEXT,
    "assinadaEm" TIMESTAMP(3),
    "status" "CessaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "cessaoId" TEXT NOT NULL,
    "metodo" "PagamentoMetodo" NOT NULL DEFAULT 'PIX_SIMULADO',
    "valor" DECIMAL(15,2) NOT NULL,
    "onChainTxHash" TEXT,
    "executadoEm" TIMESTAMP(3),
    "comprovanteUrl" TEXT,
    "status" "PagamentoStatus" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadComprador" (
    "id" TEXT NOT NULL,
    "origem" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "documento" TEXT,
    "tipo" "LeadCompradorTipo" NOT NULL DEFAULT 'PESSOA_FISICA',
    "intencaoBem" TEXT,
    "faixaCapital" TEXT,
    "prazoDecisao" TEXT,
    "status" "LeadCompradorStatus" NOT NULL DEFAULT 'NOVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadComprador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reserva" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "leadCompradorId" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "sinalSimulado" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "onChainTxHash" TEXT,
    "status" "ReservaStatus" NOT NULL DEFAULT 'ATIVA',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealizacaoCaminho" (
    "id" TEXT NOT NULL,
    "cotaId" TEXT NOT NULL,
    "caminho" "CaminhoRealizacao" NOT NULL,
    "leadCompradorId" TEXT,
    "valorRealizado" DECIMAL(15,2) NOT NULL,
    "custoAquisicao" DECIMAL(15,2) NOT NULL,
    "spread" DECIMAL(15,2) NOT NULL,
    "onChainTxHash" TEXT,
    "executadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operador" TEXT,

    CONSTRAINT "RealizacaoCaminho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadVendedor_email_key" ON "LeadVendedor"("email");

-- CreateIndex
CREATE INDEX "LeadVendedor_status_idx" ON "LeadVendedor"("status");

-- CreateIndex
CREATE INDEX "LeadVendedor_criadoEm_idx" ON "LeadVendedor"("criadoEm");

-- CreateIndex
CREATE INDEX "Oferta_leadVendedorId_idx" ON "Oferta"("leadVendedorId");

-- CreateIndex
CREATE INDEX "Oferta_status_idx" ON "Oferta"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Cessao_ofertaId_key" ON "Cessao"("ofertaId");

-- CreateIndex
CREATE INDEX "Cessao_status_idx" ON "Cessao"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_cessaoId_key" ON "Pagamento"("cessaoId");

-- CreateIndex
CREATE INDEX "Pagamento_status_idx" ON "Pagamento"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadComprador_email_key" ON "LeadComprador"("email");

-- CreateIndex
CREATE INDEX "LeadComprador_status_idx" ON "LeadComprador"("status");

-- CreateIndex
CREATE INDEX "Reserva_cotaId_idx" ON "Reserva"("cotaId");

-- CreateIndex
CREATE INDEX "Reserva_status_idx" ON "Reserva"("status");

-- CreateIndex
CREATE INDEX "Reserva_expiraEm_idx" ON "Reserva"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "RealizacaoCaminho_cotaId_key" ON "RealizacaoCaminho"("cotaId");

-- CreateIndex
CREATE INDEX "RealizacaoCaminho_caminho_idx" ON "RealizacaoCaminho"("caminho");

-- CreateIndex
CREATE UNIQUE INDEX "Cota_cessaoId_key" ON "Cota"("cessaoId");

-- CreateIndex
CREATE INDEX "EventoAudit_leadVendedorId_idx" ON "EventoAudit"("leadVendedorId");

-- CreateIndex
CREATE INDEX "EventoAudit_leadCompradorId_idx" ON "EventoAudit"("leadCompradorId");

-- CreateIndex
CREATE INDEX "EventoAudit_cessaoId_idx" ON "EventoAudit"("cessaoId");

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_cessaoId_fkey" FOREIGN KEY ("cessaoId") REFERENCES "Cessao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oferta" ADD CONSTRAINT "Oferta_leadVendedorId_fkey" FOREIGN KEY ("leadVendedorId") REFERENCES "LeadVendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cessao" ADD CONSTRAINT "Cessao_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "Oferta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_cessaoId_fkey" FOREIGN KEY ("cessaoId") REFERENCES "Cessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_leadCompradorId_fkey" FOREIGN KEY ("leadCompradorId") REFERENCES "LeadComprador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealizacaoCaminho" ADD CONSTRAINT "RealizacaoCaminho_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealizacaoCaminho" ADD CONSTRAINT "RealizacaoCaminho_leadCompradorId_fkey" FOREIGN KEY ("leadCompradorId") REFERENCES "LeadComprador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_leadVendedorId_fkey" FOREIGN KEY ("leadVendedorId") REFERENCES "LeadVendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "Oferta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_cessaoId_fkey" FOREIGN KEY ("cessaoId") REFERENCES "Cessao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_leadCompradorId_fkey" FOREIGN KEY ("leadCompradorId") REFERENCES "LeadComprador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

