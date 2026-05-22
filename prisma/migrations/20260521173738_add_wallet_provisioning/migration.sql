-- CreateTable
CREATE TABLE "WalletProvisioning" (
    "privyId" TEXT NOT NULL,
    "publicKey" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletProvisioning_pkey" PRIMARY KEY ("privyId")
);
