-- E1-2 (F-FIA-3): a reabertura é auditada com ação por provedor (sandbox/simulado ≠ real). Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'PIX_SANDBOX_REABERTO';
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'PIX_SIMULADO_REABERTO';
