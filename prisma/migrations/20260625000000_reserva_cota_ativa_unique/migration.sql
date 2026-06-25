-- Uma cota só pode ter UMA reserva ATIVA por vez (backstop no nível do DB do
-- claim atômico em criarReserva). Índice unique PARCIAL — Prisma não expressa
-- WHERE no schema, então fica como SQL cru e não é introspectável.
CREATE UNIQUE INDEX "Reserva_cotaId_ativa_key"
  ON "Reserva" ("cotaId")
  WHERE "status" = 'ATIVA';
