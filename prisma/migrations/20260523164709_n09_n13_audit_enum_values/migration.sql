-- N-13: RESERVA_CANCELADA — cancelarReserva grava audit + on-chain hash.
-- N-09: WALLET_FUNDED — cap diário do funder em mainnet via EventoAudit.
--
-- ALTER TYPE ... ADD VALUE não roda dentro de transação (Postgres < 14).
-- Neon é >= 14, mas mantemos o padrão seguro: cada ADD em statement próprio.

ALTER TYPE "AcaoAudit" ADD VALUE 'RESERVA_CANCELADA';
ALTER TYPE "AcaoAudit" ADD VALUE 'WALLET_FUNDED';
