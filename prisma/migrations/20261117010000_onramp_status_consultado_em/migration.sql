-- Trava por ordem da consulta de status ao anchor (onramp/status). Aditiva e idempotente: coluna nula, sem default,
-- sem índice (a busca é pela chave primária) e sem backfill; em Postgres >= 11 é só metadado. Aplicar ANTES do código.
ALTER TABLE "OnRampOrder" ADD COLUMN IF NOT EXISTS "statusConsultadoEm" TIMESTAMP(3);
