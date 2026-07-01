/**
 * POST /api/conta/kyc
 *
 * Headers: Authorization: Bearer <privy-access-token>
 * Body: { nome?, cpf?, papel='CEDENTE', bankAccount? }
 *
 * KYC da Pessoa (uma vez, compartilhado entre papéis). Cria customer
 * Etherfuse + KYC SEP-12 + (opcional) conta Pix. Idempotente: se a Pessoa já
 * tem KYC aprovado, não re-roda Etherfuse — só acrescenta o papel/banco.
 *
 * Caro (Etherfuse + DB) → rate-limit sensitiveAuthLimiter por IP.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Papel } from '@prisma/client';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { ensureKycForPessoa } from '@/lib/services/pessoa';
import { parseBody } from '@/lib/http/parse-body';
import { sensitiveAuthLimiter, clientIp } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const Schema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    cpf: z.string().max(40).optional(),
    papel: z.enum(['CEDENTE', 'INVESTIDOR']).default('CEDENTE'),
    telefone: z.string().min(8).max(20).optional(),
    occupation: z.string().min(1).max(100).optional(),
    dataNascimento: z.string().max(20).optional(),
    endereco: z
      .object({
        rua: z.string().min(1).max(200),
        cidade: z.string().min(1).max(100),
        estado: z.string().min(1).max(50),
        cep: z.string().min(1).max(20),
      })
      .optional(),
    bankAccount: z
      .object({
        pixKey: z.string().min(1).max(200),
        pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random', 'evp']),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        cpf: z.string().min(11).max(40),
      })
      .optional(),
  })
  .strict();

export const POST = withPessoaAuth(async (req, { user }) => {
  if (!(await sensitiveAuthLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;

  try {
    const result = await ensureKycForPessoa({
      privyId: user.privyId,
      email: user.email,
      nome: body.nome,
      cpf: body.cpf,
      papel: body.papel === 'INVESTIDOR' ? Papel.INVESTIDOR : Papel.CEDENTE,
      bankAccount: body.bankAccount,
      telefone: body.telefone,
      occupation: body.occupation,
      dataNascimento: body.dataNascimento,
      endereco: body.endereco,
    });
    return NextResponse.json({
      pessoaId: result.pessoaId,
      kycAprovado: result.kycAprovado,
      kycStatus: result.kycStatus,
      papeis: result.papeis,
      etherfuseBankAccountId: result.etherfuseBankAccountId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const isClientError = message.startsWith('cpf obrigatório');
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
});
