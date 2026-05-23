-- C-04: idempotência on-chain pros submits financeiros (swap + liquidação).

-- Quote.submitXdrHash: reserva da request pelo sha256(xdr).
ALTER TABLE "Quote" ADD COLUMN "submitXdrHash" TEXT;
CREATE UNIQUE INDEX "Quote_submitXdrHash_key" ON "Quote"("submitXdrHash");

-- LiquidacaoSubmit: tabela própria (liquidação não tem Quote).
CREATE TABLE "LiquidacaoSubmit" (
    "id" TEXT NOT NULL,
    "xdrHash" TEXT NOT NULL,
    "investidorId" TEXT NOT NULL,
    "txHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiquidacaoSubmit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiquidacaoSubmit_xdrHash_key" ON "LiquidacaoSubmit"("xdrHash");
CREATE INDEX "LiquidacaoSubmit_investidorId_idx" ON "LiquidacaoSubmit"("investidorId");
