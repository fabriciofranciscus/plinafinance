/**
 * POST /api/investidor/bank-account/register
 *
 * PLINA-MOD-006: registra bank PIX programaticamente na Etherfuse (descoberta
 * 2026-05-25 via etherfuse-pix-demo gap #3). Sem isso, on-ramp PIX/BRL
 * sempre cai no mock. Pré-req: customer onboarded (etherfuseCustomerId
 * presente) + KYC approved.
 *
 * Body: { pixKey, pixKeyType, cpf, firstName, lastName }
 * Returns: { bankAccountId, status, idempotent? }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = (await req.json()) as {
      pixKey?: string;
      pixKeyType?: string;
      cpf?: string;
      firstName?: string;
      lastName?: string;
    };
    const { pixKey, pixKeyType, cpf, firstName, lastName } = body;
    if (!pixKey || !pixKeyType || !cpf || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'pixKey, pixKeyType, cpf, firstName, lastName obrigatórios' },
        { status: 400 },
      );
    }

    const investidor = await db.investidor.findUnique({
      where: { id: user.investidorId },
      select: {
        id: true,
        publicKey: true,
        etherfuseCustomerId: true,
        etherfuseBankAccountId: true,
      },
    });
    if (!investidor) {
      return NextResponse.json({ error: 'investidor não encontrado' }, { status: 404 });
    }
    if (!investidor.etherfuseCustomerId) {
      return NextResponse.json(
        { error: 'investidor sem etherfuseCustomerId — refaça onboarding' },
        { status: 409 },
      );
    }

    // Idempotência: bank já registrado.
    if (investidor.etherfuseBankAccountId) {
      return NextResponse.json({
        bankAccountId: investidor.etherfuseBankAccountId,
        status: 'active',
        idempotent: true,
      });
    }

    const apiKey = process.env.ETHERFUSE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ETHERFUSE_API_KEY ausente' },
        { status: 500 },
      );
    }
    const anchor = new EtherfuseClient({
      apiKey,
      baseUrl:
        process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
    });

    // Gera novo stub bankAccountId pro presignedUrl. Etherfuse aceita
    // qualquer UUID; o register depois amarra esse UUID ao customer.
    const bankAccountStubId = crypto.randomUUID();
    const presignedUrl = await anchor.getKycUrl(
      investidor.etherfuseCustomerId,
      investidor.publicKey,
      bankAccountStubId,
    );

    const bankResp = await anchor.registerPixBankAccount(presignedUrl, {
      pixKey,
      pixKeyType,
      cpf,
      firstName,
      lastName,
    });

    const accountId = (bankResp as unknown as { accountId?: string; bankAccountId?: string })
      .accountId ?? bankResp.bankAccountId;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Etherfuse retornou response sem accountId' },
        { status: 502 },
      );
    }

    await db.$transaction(async (tx) => {
      await tx.investidor.update({
        where: { id: investidor.id },
        data: { etherfuseBankAccountId: accountId },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'BANK_ACCOUNT_REGISTRADA',
          operador: 'investidor-self-service',
          investidorId: investidor.id,
          privyId: user.privyId,
          payloadJson: {
            accountId,
            status: bankResp.status,
            compliant: bankResp.compliant ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({
      bankAccountId: accountId,
      status: bankResp.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
});
