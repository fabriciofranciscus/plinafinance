-- E1-2: rótulo do Pix de sandbox (Asaas) distinto do simulado e do real. Aditiva e idempotente.
ALTER TYPE "PagamentoMetodo" ADD VALUE IF NOT EXISTS 'PIX_SANDBOX';
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'PIX_SANDBOX_EXECUTADO';
