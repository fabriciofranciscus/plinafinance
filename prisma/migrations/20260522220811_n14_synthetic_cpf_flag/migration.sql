-- N-14: CPF normalizado + flag de sintético em Investidor.
ALTER TABLE "Investidor" ADD COLUMN "cpfNormalizado" TEXT;
ALTER TABLE "Investidor" ADD COLUMN "isSyntheticCpf" BOOLEAN NOT NULL DEFAULT false;
