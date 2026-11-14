-- TES-2 / X4 (Argus): evento append-only da execução da TES-2 (tokens do distributor movidos para a conta de posição),
-- gravado com o MESMO registro canônico que virou o memo da tx. Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'TESOURARIA_LEGADA_MOVIDA';
