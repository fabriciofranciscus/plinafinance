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
import { ApiError } from '@/lib/api/errors';
import { isMaiorDeIdade } from '@/lib/format/idade';
import { isUfValida } from '@/lib/format/uf';

export const dynamic = 'force-dynamic';

// Data URL base64 de imagem comprimida client-side (canvas, JPEG ~0.82,
// lado maior <=1600px) — .max() é defesa em profundidade contra payload
// gigante mesmo se o client não comprimir (ex.: chamada direta à API).
const ImagemDataUrl = z.string().min(1).max(2_000_000);

const Schema = z
  .object({
    // Nome sozinho (sem sobrenome) cai em fallbacks ruins downstream
    // (pessoa.ts usa 'Plina' como familyName) — errado num registro AML real.
    nome: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .refine((v) => !v || v.trim().split(/\s+/).length >= 2, 'informe nome e sobrenome'),
    cpf: z.string().max(40).optional(),
    papel: z.enum(['CEDENTE', 'INVESTIDOR']).default('CEDENTE'),
    telefone: z.string().min(8).max(20).optional(),
    occupation: z.string().min(1).max(100).optional(),
    // Validado no client (feedback imediato) e aqui de novo — validação
    // client-side é sempre contornável, e KYC/AML exige maioridade.
    dataNascimento: z
      .string()
      .max(20)
      .optional()
      .refine((v) => !v || isMaiorDeIdade(v), 'cedente precisa ser maior de 18 anos'),
    // Campos opcionais Etherfuse (só produção — pessoa.ts filtra por env).
    middleName: z.string().min(1).max(100).optional(),
    motherMaidenName: z.string().min(1).max(100).optional(),
    preferredName: z.string().min(1).max(100).optional(),
    useEmailForMarketing: z.boolean().optional(),
    endereco: z
      .object({
        rua: z.string().min(1).max(200),
        cidade: z.string().min(1).max(100),
        estado: z
          .string()
          .min(1)
          .max(50)
          .refine((v) => isUfValida(v), 'UF inválida'),
        cep: z.string().min(1).max(20),
        street2: z.string().min(1).max(200).optional(),
      })
      .optional(),
    documentos: z
      .object({
        idFront: ImagemDataUrl,
        idBack: ImagemDataUrl,
        selfie: ImagemDataUrl,
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
      middleName: body.middleName,
      motherMaidenName: body.motherMaidenName,
      preferredName: body.preferredName,
      useEmailForMarketing: body.useEmailForMarketing,
      documentos: body.documentos,
    });
    return NextResponse.json({
      pessoaId: result.pessoaId,
      kycAprovado: result.kycAprovado,
      kycStatus: result.kycStatus,
      papeis: result.papeis,
      etherfuseBankAccountId: result.etherfuseBankAccountId,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
