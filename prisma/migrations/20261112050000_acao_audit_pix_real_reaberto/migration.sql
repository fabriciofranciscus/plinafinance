-- E1-2 (reabrir auditado): ação de auditoria da reabertura de um Pix de saída. Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'PIX_REAL_REABERTO';
