-- CreateEnum (idempotente)
DO $$ BEGIN
  CREATE TYPE "TipoMovimentoFundo" AS ENUM ('SUBSCRICAO', 'APORTE_COTA', 'AQUISICAO', 'REALIZACAO', 'RESGATE_PAGO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MovimentoFundo" (
    "id" TEXT NOT NULL,
    "tipo" "TipoMovimentoFundo" NOT NULL,
    "valorBrl" DECIMAL(20,7) NOT NULL,
    "deltaCaixa" DECIMAL(20,7) NOT NULL,
    "deltaTokens" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "chave" TEXT NOT NULL,
    "cotaId" TEXT,
    "quoteId" TEXT,
    "refHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoFundo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MovimentoFundo_chave_key" ON "MovimentoFundo"("chave");
CREATE INDEX IF NOT EXISTS "MovimentoFundo_tipo_idx" ON "MovimentoFundo"("tipo");

-- Backfill idempotente (mesmas chaves do código: reexecutar não duplica).
-- 1) Realizações já feitas: caixa +valorRealizado.
INSERT INTO "MovimentoFundo" ("id", "tipo", "valorBrl", "deltaCaixa", "deltaTokens", "chave", "cotaId", "refHash")
SELECT 'bf_real_' || r."id", 'REALIZACAO', r."valorRealizado", r."valorRealizado", 0,
       'realizacao:' || r."id", r."cotaId", r."onChainTxHash"
FROM "RealizacaoCaminho" r
ON CONFLICT ("chave") DO NOTHING;

-- 2) Cotas já incorporadas (token cunhado): APORTE_COTA pelo custo de aquisição,
--    q = tokens já cunhados, caixa 0.
INSERT INTO "MovimentoFundo" ("id", "tipo", "valorBrl", "deltaCaixa", "deltaTokens", "chave", "cotaId", "refHash")
SELECT 'bf_aporte_' || c."id", 'APORTE_COTA',
       ROUND(c."valorCarta" * (1 - c."desagioAquisicao"), 2), 0, c."tokensEmitidos",
       'aporte-cota:' || c."id", c."id", COALESCE(c."emissaoTxHash", c."hashValidacao")
FROM "Cota" c
WHERE c."emissaoTxHash" IS NOT NULL AND c."tokensEmitidos" > 0
ON CONFLICT ("chave") DO NOTHING;
