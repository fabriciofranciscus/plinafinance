-- TES-3 (Atlas/Consuelo): evento append-only da queima do excesso de PLINARF da posição da Plina, gravado com o MESMO
-- registro canônico que virou o memo da tx. Aditiva e idempotente.
ALTER TYPE "AcaoAudit" ADD VALUE IF NOT EXISTS 'TESOURARIA_EXCESSO_QUEIMADA';
