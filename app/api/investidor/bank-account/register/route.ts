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
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    pixKey: z.string().min(1).max(200),
    pixKeyType: z.enum(['cpf', 'email', 'phone', 'random']),
    cpf: z.string().min(11).max(40),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { pixKey, pixKeyType, cpf, firstName, lastName } = parsed.data;
  try {
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

    const custId = investidor.etherfuseCustomerId;
    const persistBank = async (
      id: string,
      status: string,
      reused: boolean,
    ) => {
      await db.$transaction(async (tx) => {
        await tx.investidor.update({
          where: { id: investidor.id },
          data: { etherfuseBankAccountId: id },
        });
        await tx.eventoAudit.create({
          data: {
            acao: 'BANK_ACCOUNT_REGISTRADA',
            operador: 'investidor-self-service',
            investidorId: investidor.id,
            privyId: user.privyId,
            payloadJson: { accountId: id, status, reused } as Prisma.InputJsonValue,
          },
        });
      });
    };

    // Reuso: se o customer já tem fiat account na Etherfuse (re-teste, ou
    // registrada noutro fluxo), reaproveita em vez de criar — evita o limite
    // "Only one BRL bank account is allowed per organization" do sandbox.
    const existing = await anchor.getFiatAccounts(custId).catch(() => []);
    const reusable = existing.find((a) => a.type === 'PIX') ?? existing[0];
    if (reusable) {
      await persistBank(reusable.id, 'active', true);
      return NextResponse.json({
        bankAccountId: reusable.id,
        status: 'active',
        idempotent: true,
      });
    }

    // Gera novo stub bankAccountId pro presignedUrl. Etherfuse aceita
    // qualquer UUID; o register depois amarra esse UUID ao customer.
    const bankAccountStubId = crypto.randomUUID();
    const presignedUrl = await anchor.getKycUrl(
      custId,
      investidor.publicKey,
      bankAccountStubId,
    );

    let bankResp;
    try {
      bankResp = await anchor.registerPixBankAccount(presignedUrl, {
        pixKey,
        pixKeyType,
        cpf,
        firstName,
        lastName,
      });
    } catch (regErr) {
      // Limite org-level do sandbox: pode haver uma conta criada após o check
      // acima (corrida) ou sob este customer. Tenta reaproveitar antes de falhar.
      const retry = await anchor.getFiatAccounts(custId).catch(() => []);
      const pix = retry.find((a) => a.type === 'PIX') ?? retry[0];
      if (pix) {
        await persistBank(pix.id, 'active', true);
        return NextResponse.json({
          bankAccountId: pix.id,
          status: 'active',
          idempotent: true,
        });
      }
      throw regErr;
    }

    const accountId = (bankResp as unknown as { accountId?: string; bankAccountId?: string })
      .accountId ?? bankResp.bankAccountId;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Etherfuse retornou response sem accountId' },
        { status: 502 },
      );
    }

    await persistBank(accountId, bankResp.status, false);

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
