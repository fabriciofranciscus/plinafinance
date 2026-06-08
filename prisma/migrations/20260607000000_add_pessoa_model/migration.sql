-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NAO_INICIADO', 'PENDENTE', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('INVESTIDOR', 'CEDENTE');

-- AlterEnum
ALTER TYPE "AcaoAudit" ADD VALUE 'CEDENTE_ONBOARDED';

-- DropIndex
DROP INDEX "Investidor_email_key";

-- AlterTable
ALTER TABLE "Investidor" ADD COLUMN     "pessoaId" TEXT;

-- AlterTable
ALTER TABLE "LeadVendedor" ADD COLUMN     "pessoaId" TEXT;

-- CreateTable
CREATE TABLE "Pessoa" (
    "id" TEXT NOT NULL,
    "privyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NAO_INICIADO',
    "kycAprovado" BOOLEAN NOT NULL DEFAULT false,
    "etherfuseCustomerId" TEXT,
    "etherfuseBankAccountId" TEXT,
    "cpfNormalizado" TEXT,
    "isSyntheticCpf" BOOLEAN NOT NULL DEFAULT false,
    "papeis" "Papel"[] DEFAULT ARRAY[]::"Papel"[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pessoa_privyId_key" ON "Pessoa"("privyId");

-- CreateIndex
CREATE UNIQUE INDEX "Pessoa_email_key" ON "Pessoa"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Pessoa_publicKey_key" ON "Pessoa"("publicKey");

-- CreateIndex
CREATE INDEX "Pessoa_kycAprovado_idx" ON "Pessoa"("kycAprovado");

-- CreateIndex
CREATE UNIQUE INDEX "Investidor_pessoaId_key" ON "Investidor"("pessoaId");

-- CreateIndex
CREATE INDEX "LeadVendedor_pessoaId_idx" ON "LeadVendedor"("pessoaId");

-- AddForeignKey
ALTER TABLE "Investidor" ADD CONSTRAINT "Investidor_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadVendedor" ADD CONSTRAINT "LeadVendedor_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

