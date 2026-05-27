-- CreateEnum
CREATE TYPE "ClassePLINARF" AS ENUM ('SENIOR', 'SUBORDINADA');

-- CreateEnum
CREATE TYPE "CaminhoCessao" AS ENUM ('API_ADMINISTRADORA', 'CARTORIO_DIGITAL');

-- CreateEnum
CREATE TYPE "TipoInvestidor" AS ENUM ('INST_BR_QUALIFICADO', 'INST_BR_PROFISSIONAL', 'INST_INTERNACIONAL_PROFISSIONAL');

-- AlterTable
ALTER TABLE "Cessao" ADD COLUMN     "administradoraApiId" TEXT,
ADD COLUMN     "caminhoCessao" "CaminhoCessao" NOT NULL DEFAULT 'CARTORIO_DIGITAL',
ADD COLUMN     "taxaAnuenciaBps" INTEGER;

-- AlterTable
ALTER TABLE "Investidor" ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "enderecoEntidade" JSONB,
ADD COLUMN     "jurisdicao" TEXT,
ADD COLUMN     "razaoSocial" TEXT,
ADD COLUMN     "suitabilityJson" JSONB,
ADD COLUMN     "ticketMinimoCheck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipo" "TipoInvestidor";

-- CreateTable
CREATE TABLE "HoldingPLINARF" (
    "id" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "classe" "ClassePLINARF" NOT NULL,
    "saldo" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "emissaoTxHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoldingPLINARF_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavSnapshot" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "navTotal" DECIMAL(20,2) NOT NULL,
    "navPorToken" DECIMAL(20,7) NOT NULL,
    "tokensVivos" DECIMAL(20,7) NOT NULL,
    "classeSeniorNav" DECIMAL(20,2) NOT NULL,
    "classeSubordinadaNav" DECIMAL(20,2) NOT NULL,
    "composicaoJson" JSONB NOT NULL,
    "publishedTxHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NavSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JanelaLiquidez" (
    "id" TEXT NOT NULL,
    "abreEm" TIMESTAMP(3) NOT NULL,
    "fechaEm" TIMESTAMP(3) NOT NULL,
    "capTotal" DECIMAL(20,2),
    "consumido" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AGENDADA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JanelaLiquidez_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrestadorRegulado" (
    "id" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "numeroRegistroCVM" TEXT,
    "urlVerificacao" TEXT,
    "ativoDesde" TIMESTAMP(3),
    "desativadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrestadorRegulado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoldingPLINARF_classe_idx" ON "HoldingPLINARF"("classe");

-- CreateIndex
CREATE UNIQUE INDEX "HoldingPLINARF_investidorId_classe_key" ON "HoldingPLINARF"("investidorId", "classe");

-- CreateIndex
CREATE UNIQUE INDEX "NavSnapshot_data_key" ON "NavSnapshot"("data");

-- CreateIndex
CREATE INDEX "NavSnapshot_data_idx" ON "NavSnapshot"("data");

-- CreateIndex
CREATE INDEX "JanelaLiquidez_abreEm_idx" ON "JanelaLiquidez"("abreEm");

-- CreateIndex
CREATE INDEX "JanelaLiquidez_status_idx" ON "JanelaLiquidez"("status");

-- CreateIndex
CREATE INDEX "PrestadorRegulado_papel_idx" ON "PrestadorRegulado"("papel");

-- CreateIndex
CREATE INDEX "Investidor_tipo_idx" ON "Investidor"("tipo");

-- CreateIndex
CREATE INDEX "Investidor_jurisdicao_idx" ON "Investidor"("jurisdicao");

-- AddForeignKey
ALTER TABLE "HoldingPLINARF" ADD CONSTRAINT "HoldingPLINARF_investidorId_fkey" FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
