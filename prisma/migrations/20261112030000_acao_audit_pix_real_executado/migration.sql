-- E1-2 (fiação): ação de auditoria do Pix de saída pelo PSP. Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'PIX_REAL_EXECUTADO';
