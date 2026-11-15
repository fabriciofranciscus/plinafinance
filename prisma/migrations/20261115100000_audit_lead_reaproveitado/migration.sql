-- A-11 (Atlas 15/11): reenvio do lead com a mesma versão do consentimento grava este evento (append-only, sem memo, sem fee,
-- sem PII) em vez de ancorar de novo. Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'LEAD_VENDEDOR_REAPROVEITADO';
