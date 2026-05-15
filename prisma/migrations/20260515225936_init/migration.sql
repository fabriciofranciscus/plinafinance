-- CreateEnum
CREATE TYPE "TipoBem" AS ENUM ('IMOVEL', 'VEICULO', 'EQUIPAMENTO', 'SERVICO');

-- CreateEnum
CREATE TYPE "StatusEstoque" AS ENUM ('VERDE', 'AMARELO', 'VERMELHO', 'BAIXA');

-- CreateEnum
CREATE TYPE "StatusCota" AS ENUM ('DISPONIVEL', 'RESERVADA', 'REALIZADA', 'REVERTIDA');

-- CreateEnum
CREATE TYPE "MotivoClawback" AS ENUM ('DECISAO_JUDICIAL', 'SANCAO_REGULATORIA', 'FRAUDE_DOCUMENTAL', 'ERRO_OPERACIONAL');

-- CreateEnum
CREATE TYPE "StatusInvestidor" AS ENUM ('PENDENTE_KYC', 'AUTORIZADO', 'REVOGADO');

-- CreateEnum
CREATE TYPE "CaminhoRealizacao" AS ENUM ('A_REVENDA', 'B_ADMINISTRADORA', 'C_PRAZO_GRUPO');

-- CreateEnum
CREATE TYPE "AcaoAudit" AS ENUM ('COTA_INCORPORADA', 'TOKEN_EMITIDO', 'INVESTIDOR_ONBOARDED', 'TRUSTLINE_AUTORIZADA', 'TRUSTLINE_REVOGADA', 'DISTRIBUICAO', 'CLAWBACK_EXECUTADO', 'COTA_REALIZADA');

-- CreateTable
CREATE TABLE "ParametrosPool" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "assetCode" TEXT NOT NULL DEFAULT 'PLINARF',
    "issuerPubkey" TEXT NOT NULL,
    "distributorPubkey" TEXT NOT NULL,
    "homeDomain" TEXT,
    "policyUrl" TEXT,
    "network" TEXT NOT NULL DEFAULT 'TESTNET',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametrosPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cota" (
    "id" TEXT NOT NULL,
    "tipoBem" "TipoBem" NOT NULL,
    "administradora" TEXT NOT NULL,
    "valorCarta" DECIMAL(15,2) NOT NULL,
    "desagioAquisicao" DECIMAL(5,4) NOT NULL,
    "desagioRevenda" DECIMAL(5,4),
    "localizacaoAprox" TEXT,
    "prazoRestanteMeses" INTEGER,
    "caminhoPrevisto" "CaminhoRealizacao" NOT NULL DEFAULT 'A_REVENDA',
    "dataAquisicao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusEstoque" "StatusEstoque" NOT NULL DEFAULT 'VERDE',
    "status" "StatusCota" NOT NULL DEFAULT 'DISPONIVEL',
    "tokensEmitidos" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "emissaoTxHash" TEXT,
    "hashCessao" TEXT,
    "notas" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investidor" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "kycAprovado" BOOLEAN NOT NULL DEFAULT false,
    "status" "StatusInvestidor" NOT NULL DEFAULT 'PENDENTE_KYC',
    "trustlineTxHash" TEXT,
    "saldoEsperado" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investidor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAudit" (
    "id" TEXT NOT NULL,
    "acao" "AcaoAudit" NOT NULL,
    "operador" TEXT,
    "cotaId" TEXT,
    "investidorId" TEXT,
    "motivoClawback" "MotivoClawback",
    "fundamentoUrl" TEXT,
    "payloadJson" JSONB,
    "stellarTxHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cota_status_idx" ON "Cota"("status");

-- CreateIndex
CREATE INDEX "Cota_statusEstoque_idx" ON "Cota"("statusEstoque");

-- CreateIndex
CREATE INDEX "Cota_tipoBem_idx" ON "Cota"("tipoBem");

-- CreateIndex
CREATE UNIQUE INDEX "Investidor_email_key" ON "Investidor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Investidor_publicKey_key" ON "Investidor"("publicKey");

-- CreateIndex
CREATE INDEX "Investidor_status_idx" ON "Investidor"("status");

-- CreateIndex
CREATE INDEX "EventoAudit_acao_idx" ON "EventoAudit"("acao");

-- CreateIndex
CREATE INDEX "EventoAudit_cotaId_idx" ON "EventoAudit"("cotaId");

-- CreateIndex
CREATE INDEX "EventoAudit_investidorId_idx" ON "EventoAudit"("investidorId");

-- CreateIndex
CREATE INDEX "EventoAudit_criadoEm_idx" ON "EventoAudit"("criadoEm");

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_cotaId_fkey" FOREIGN KEY ("cotaId") REFERENCES "Cota"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAudit" ADD CONSTRAINT "EventoAudit_investidorId_fkey" FOREIGN KEY ("investidorId") REFERENCES "Investidor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
