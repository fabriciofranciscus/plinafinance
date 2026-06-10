-- M3: ENTIDADE_PREENCHIDA — onboarding institucional grava razão social /
-- CNPJ / jurisdição nas colunas do Investidor + audit log (POST
-- /api/investidor/entidade).
--
-- ALTER TYPE ... ADD VALUE não roda dentro de transação (Postgres < 14).
-- Neon é >= 14, mas mantemos o padrão seguro: ADD em statement próprio.

ALTER TYPE "AcaoAudit" ADD VALUE 'ENTIDADE_PREENCHIDA';
