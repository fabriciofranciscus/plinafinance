/**
 * Pessoa service — KYC unificado por `privyId`, compartilhado entre papéis
 * (investidor E cedente). Feito UMA vez: se a Pessoa já está `kycAprovado`,
 * não re-roda Etherfuse — só acrescenta o papel e, se vier, registra a conta
 * bancária.
 *
 * Núcleo Etherfuse (createCustomer + KYC programático + bank Pix) levantado
 * de `lib/services/investidor.ts` pra ser reusado por ambos os fluxos. O
 * `onboardInvestidor` chama `ensureKycForPessoa({papel:INVESTIDOR})` e então
 * conecta o Investidor à Pessoa.
 *
 * Wallet: `ensureStellarWallet` é idempotente — reusa a wallet criada no login
 * do Privy (cria só se a conta ainda não tiver). É exigida pelo Etherfuse como
 * identificador do customer; o cedente NÃO recebe trustline/compra de token.
 */

import { createHash } from 'node:crypto';
import { Prisma, KycStatus, Papel } from '@prisma/client';
import { db } from '../db';
import { ensureStellarWallet } from '../wallet/privy';
import { fundAccountIfNeeded } from '../stellar/account';
import { STELLAR_NETWORK } from '../stellar/config';
import { logStellarError } from '../stellar/log-error';
import { EtherfuseClient } from '../anchors/etherfuse';
import { parseCpf } from '../format/parse-cpf';
import { ApiError } from '../api/errors';
import { etherfuseIsProduction } from '../env/etherfuse';

const DUMMY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

function documentosCompletos(docs?: DocumentosKycInput): docs is DocumentosKycInput {
  return !!docs?.idFront && !!docs?.idBack && !!docs?.selfie;
}

/** SHA-256 hex da imagem — auditoria sem persistir a imagem/base64 crua (LGPD). */
function hashDataUrl(dataUrl: string): string {
  return createHash('sha256').update(dataUrl).digest('hex');
}

export function etherfuseFromEnv(): EtherfuseClient {
  const apiKey = process.env.ETHERFUSE_API_KEY;
  const baseUrl =
    process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com';
  if (!apiKey) {
    throw new Error('ETHERFUSE_API_KEY ausente.');
  }
  return new EtherfuseClient({ apiKey, baseUrl });
}

/** Conta bancária Pix do off-ramp (destino do pagamento). */
export interface PixBankAccountInput {
  pixKey: string;
  pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random' | 'evp';
  firstName: string;
  lastName: string;
  cpf: string;
}

/** Endereço residencial — identidade Etherfuse (BR). */
export interface EnderecoInput {
  rua: string;
  cidade: string;
  estado: string;
  cep: string;
  /** Complemento. Campo opcional Etherfuse, só enviado em produção. */
  street2?: string;
}

/** Fotos de documento + selfie (data URL base64), pro upload real de KYC. */
export interface DocumentosKycInput {
  idFront: string;
  idBack: string;
  selfie: string;
}

export interface EnsureKycInput {
  privyId: string;
  email: string;
  nome?: string;
  cpf?: string;
  papel: Papel;
  bankAccount?: PixBankAccountInput;
  /** E.164 (ex: +5511999999999). Exigido pelo customer-agreement Etherfuse. */
  telefone?: string;
  /** Ocupação/cargo declarado. Exigido pelo customer-agreement Etherfuse. */
  occupation?: string;
  /** ISO 8601 (ex: 1990-05-15). */
  dataNascimento?: string;
  endereco?: EnderecoInput;
  /** Nome do meio. Campo opcional Etherfuse, só enviado em produção. */
  middleName?: string;
  /** Sobrenome de solteira da mãe. Campo opcional Etherfuse, só produção. */
  motherMaidenName?: string;
  /** Nome preferido/social. Campo opcional Etherfuse, só produção. */
  preferredName?: string;
  /** Consentimento de marketing. Campo opcional Etherfuse, só produção. */
  useEmailForMarketing?: boolean;
  /**
   * Fotos reais de documento + selfie. Obrigatório em produção (fail-closed
   * antes de chamar a Etherfuse); em sandbox, se ausente, cai no fallback
   * `DUMMY_PNG_BASE64` (Etherfuse não valida conteúdo em sandbox).
   */
  documentos?: DocumentosKycInput;
  /**
   * Emite EventoAudit (CEDENTE/INVESTIDOR_ONBOARDED) com `privyId`. Default
   * true. `onboardInvestidor` passa false pra emitir o seu próprio log com
   * `investidorId` (consumido por /minha-posicao + events API).
   */
  emitAudit?: boolean;
}

export interface EnsureKycResult {
  pessoaId: string;
  publicKey: string;
  etherfuseCustomerId: string | null;
  etherfuseBankAccountId: string | null;
  kycStatus: KycStatus;
  kycAprovado: boolean;
  cpfNormalizado: string | null;
  isSyntheticCpf: boolean;
  papeis: Papel[];
  fundedNow: boolean;
}

function mapEtherfuseKyc(status: string): KycStatus {
  if (status === 'approved') return KycStatus.APROVADO;
  if (status === 'pending') return KycStatus.PENDENTE;
  if (status === 'rejected') return KycStatus.REJEITADO;
  return KycStatus.NAO_INICIADO;
}

/**
 * CPF normalizado + flag sintético (N-14). Lança em mainnet OU em KYC de
 * produção sem CPF real — dois gates independentes porque `ETHERFUSE_ENV`
 * (produção do KYC) pode estar ativo em `STELLAR_NETWORK=TESTNET` (mesmo
 * setup usado nesta sessão pra construir/testar o fluxo completo). Sem o
 * segundo gate, um CPF inválido cairia no fallback sintético mesmo com
 * nome/endereço/fotos reais já coletados — identidade inconsistente enviada
 * à Etherfuse (descoberto na auditoria de 2026-07-01).
 */
function resolveCpf(cpf?: string): { cpfNormalizado: string; isSyntheticCpf: boolean } {
  const exigeCpfReal = STELLAR_NETWORK === 'PUBLIC' || etherfuseIsProduction();
  const parsed = parseCpf(cpf);
  if (exigeCpfReal) {
    if (!parsed)
      throw new ApiError(
        'VALIDATION_FAILED',
        400,
        'cpf inválido (precisa ser um CPF real, válido por módulo 11)',
      );
    return { cpfNormalizado: parsed, isSyntheticCpf: false };
  }
  return { cpfNormalizado: parsed ?? '52998224725', isSyntheticCpf: !parsed };
}

/**
 * Registra conta Pix no Etherfuse e devolve o accountId. Espelha
 * `app/api/investidor/bank-account/register/route.ts`.
 */
export async function registerPixForPessoa(args: {
  etherfuseCustomerId: string;
  publicKey: string;
  account: PixBankAccountInput;
}): Promise<string> {
  const anchor = etherfuseFromEnv();
  const bankAccountStubId = crypto.randomUUID();
  const presignedUrl = await anchor.getKycUrl(
    args.etherfuseCustomerId,
    args.publicKey,
    bankAccountStubId,
  );
  const resp = await anchor.registerPixBankAccount(presignedUrl, args.account);
  const accountId =
    (resp as unknown as { accountId?: string; bankAccountId?: string }).accountId ??
    resp.bankAccountId;
  if (!accountId) {
    throw new Error('Etherfuse retornou response sem accountId');
  }
  return accountId;
}

/**
 * Garante KYC pra Pessoa (idempotente, role-aware). Se já aprovado, só
 * acrescenta o papel e registra bank se pedido — sem re-rodar Etherfuse.
 * Caso contrário roda o fluxo Etherfuse completo e cria/atualiza a Pessoa.
 */
export async function ensureKycForPessoa(
  input: EnsureKycInput,
): Promise<EnsureKycResult> {
  const existing = await db.pessoa.findUnique({
    where: { privyId: input.privyId },
  });

  // ── Caminho idempotente: KYC já aprovado (possivelmente noutro papel) ──
  if (existing && existing.kycAprovado) {
    let bankAccountId = existing.etherfuseBankAccountId;
    if (
      input.bankAccount &&
      !bankAccountId &&
      existing.etherfuseCustomerId &&
      existing.publicKey
    ) {
      // Best-effort (igual ao caminho completo): uma falha transitória do
      // Etherfuse não pode derrubar (500) quem já tem KYC aprovado. A conta
      // pode ser re-registrada depois.
      try {
        bankAccountId = await registerPixForPessoa({
          etherfuseCustomerId: existing.etherfuseCustomerId,
          publicKey: existing.publicKey,
          account: input.bankAccount,
        });
      } catch (err) {
        logStellarError('[ensureKyc:bank:idempotente]', err);
      }
    }
    const papeis = existing.papeis.includes(input.papel)
      ? existing.papeis
      : [...existing.papeis, input.papel];

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.pessoa.update({
        where: { id: existing.id },
        data: {
          papeis: { set: papeis },
          etherfuseBankAccountId: bankAccountId,
          nome: input.nome ?? existing.nome,
        },
      });
      if (input.emitAudit !== false) {
        await tx.eventoAudit.create({
          data: {
            acao: input.papel === Papel.CEDENTE ? 'CEDENTE_ONBOARDED' : 'INVESTIDOR_ONBOARDED',
            operador: 'self-service',
            privyId: input.privyId,
            payloadJson: {
              reused: true,
              papel: input.papel,
              bankRegistered: !!input.bankAccount,
            } as Prisma.InputJsonValue,
          },
        });
      }
      return p;
    });

    return {
      pessoaId: updated.id,
      publicKey: updated.publicKey,
      etherfuseCustomerId: updated.etherfuseCustomerId,
      etherfuseBankAccountId: updated.etherfuseBankAccountId,
      kycStatus: updated.kycStatus,
      kycAprovado: updated.kycAprovado,
      cpfNormalizado: updated.cpfNormalizado,
      isSyntheticCpf: updated.isSyntheticCpf,
      papeis: updated.papeis,
      fundedNow: false,
    };
  }

  // ── Caminho completo: roda Etherfuse ──
  const isProd = etherfuseIsProduction();

  // Fail-closed: em produção, sem as 3 fotos não vale nem criar o customer
  // na Etherfuse — ficaria fadado a nunca aprovar (sem doc/selfie reais, o
  // OCR/face-match/liveness nunca roda).
  if (isProd && !documentosCompletos(input.documentos)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      400,
      'documentos de KYC (frente, verso e selfie) obrigatórios em produção',
    );
  }

  const { cpfNormalizado, isSyntheticCpf } = resolveCpf(input.cpf);

  const publicKey = await ensureStellarWallet(input.privyId);
  const fund = await fundAccountIfNeeded(publicKey);

  const anchor = etherfuseFromEnv();
  const customer = await anchor.createCustomer({
    email: input.email,
    publicKey,
    country: 'BR',
  });

  await anchor.submitKycIdentity(customer.id, {
    pubkey: publicKey,
    identity: {
      name: {
        givenName: input.nome?.split(' ')[0] ?? 'Cliente',
        familyName: input.nome?.split(' ').slice(1).join(' ').trim() || 'Plina',
        // Campos opcionais Etherfuse — só enviados em produção; em sandbox
        // são omitidos por completo, mesmo se o caller passar valor.
        ...(isProd && input.middleName ? { middleName: input.middleName } : {}),
        ...(isProd && input.motherMaidenName
          ? { motherMaidenName: input.motherMaidenName }
          : {}),
        ...(isProd && input.preferredName ? { preferredName: input.preferredName } : {}),
      },
      // email/phoneNumber/occupation passaram a ser exigidos pelo
      // customer-agreement do Etherfuse (descoberto 2026-07-01, junto com
      // a remoção de idNumbers para BR). Fallback placeholder pros fluxos
      // (comprar/investir) que ainda não coletam esses campos no onboarding.
      dateOfBirth: input.dataNascimento ?? '1985-01-15',
      email: input.email,
      phoneNumber: input.telefone ?? '+5511999999999',
      occupation: input.occupation ?? 'Professional',
      address: {
        street: input.endereco?.rua ?? 'Av. Faria Lima, 1000',
        city: input.endereco?.cidade ?? 'São Paulo',
        region: input.endereco?.estado ?? 'SP',
        postalCode: input.endereco?.cep ?? '01310-100',
        country: 'BR',
        ...(isProd && input.endereco?.street2 ? { street2: input.endereco.street2 } : {}),
      },
      // idNumbers (CPF) removido: Etherfuse só aceita esse campo para MX.
      ...(isProd && input.useEmailForMarketing !== undefined
        ? { useEmailForMarketing: input.useEmailForMarketing }
        : {}),
    },
  });

  // Documentos: em sandbox, best-effort (a identidade já auto-aprova e
  // customers reusados podem 400 com "Too many pending documents" — não
  // pode derrubar o onboarding). Em produção, o upload é a submissão real
  // de OCR/face-match — falha real precisa propagar pro usuário saber que a
  // foto foi rejeitada, não pode ficar preso em erro silencioso.
  //
  // Reenvio: se essa Pessoa já mandou documentos antes (kycDocumentosEnviadosEm
  // setado) e ainda não foi aprovada, não força reenvio de foto real a cada
  // retry — assume que os docs já estão em análise na Etherfuse.
  let documentosEnviadosAgora = false;
  if (!existing?.kycDocumentosEnviadosEm) {
    const docs = input.documentos;
    const isDummyFallback = !isProd && !documentosCompletos(docs);
    const submitDocs = async () => {
      await anchor.submitKycDocuments(customer.id, {
        pubkey: publicKey,
        documentType: 'document',
        images: [
          { label: 'id_front', image: docs?.idFront ?? DUMMY_PNG_BASE64 },
          { label: 'id_back', image: docs?.idBack ?? DUMMY_PNG_BASE64 },
        ],
      });
      await anchor.submitKycDocuments(customer.id, {
        pubkey: publicKey,
        documentType: 'selfie',
        images: [{ label: 'selfie', image: docs?.selfie ?? DUMMY_PNG_BASE64 }],
      });
    };
    if (isProd) {
      await submitDocs();
      documentosEnviadosAgora = true;
    } else {
      try {
        await submitDocs();
        documentosEnviadosAgora = true;
      } catch (err) {
        logStellarError('[ensureKyc:documents]', err);
      }
    }
    if (documentosEnviadosAgora) {
      await db.eventoAudit.create({
        data: {
          acao: 'KYC_DOCUMENTOS_ENVIADOS',
          operador: 'self-service',
          privyId: input.privyId,
          payloadJson: {
            idFrontHash: hashDataUrl(docs?.idFront ?? DUMMY_PNG_BASE64),
            idBackHash: hashDataUrl(docs?.idBack ?? DUMMY_PNG_BASE64),
            selfieHash: hashDataUrl(docs?.selfie ?? DUMMY_PNG_BASE64),
            isDummyFallback,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
  const kycUrl = await anchor.getKycUrl(customer.id, publicKey, customer.bankAccountId);
  try {
    await anchor.acceptElectronicSignature(kycUrl);
    await anchor.acceptTermsAndConditions(kycUrl);
  } catch (err) {
    logStellarError('[ensureKyc:agreements]', err);
  }

  let kycStatus: KycStatus = KycStatus.PENDENTE;
  try {
    kycStatus = mapEtherfuseKyc(await anchor.getKycStatus(customer.id, publicKey));
  } catch (err) {
    logStellarError('[ensureKyc:kyc-status]', err);
  }

  // Bank Pix é best-effort: não pode derrubar (nem perder) o KYC já aprovado.
  // Pix de pagamento está simulado por ora; a conta pode ser re-registrada
  // depois caso falhe.
  let bankAccountId: string | null = null;
  if (input.bankAccount) {
    try {
      bankAccountId = await registerPixForPessoa({
        etherfuseCustomerId: customer.id,
        publicKey,
        account: input.bankAccount,
      });
    } catch (err) {
      logStellarError('[ensureKyc:bank]', err);
    }
  }

  const aprovado = kycStatus === KycStatus.APROVADO;

  const pessoa = await db.$transaction(async (tx) => {
    const upserted = await tx.pessoa.upsert({
      where: { privyId: input.privyId },
      create: {
        privyId: input.privyId,
        email: input.email,
        nome: input.nome ?? input.email,
        publicKey,
        kycStatus,
        kycAprovado: aprovado,
        etherfuseCustomerId: customer.id,
        etherfuseBankAccountId: bankAccountId,
        cpfNormalizado,
        isSyntheticCpf,
        papeis: [input.papel],
        kycDocumentosEnviadosEm: documentosEnviadosAgora ? new Date() : undefined,
      },
      update: {
        nome: input.nome ?? undefined,
        publicKey,
        kycStatus,
        kycAprovado: aprovado,
        etherfuseCustomerId: customer.id,
        etherfuseBankAccountId: bankAccountId ?? undefined,
        cpfNormalizado,
        isSyntheticCpf,
        kycDocumentosEnviadosEm: documentosEnviadosAgora
          ? new Date()
          : existing?.kycDocumentosEnviadosEm ?? undefined,
        papeis: existing
          ? { set: existing.papeis.includes(input.papel) ? existing.papeis : [...existing.papeis, input.papel] }
          : { set: [input.papel] },
      },
    });
    if (input.emitAudit !== false) {
      await tx.eventoAudit.create({
        data: {
          acao: input.papel === Papel.CEDENTE ? 'CEDENTE_ONBOARDED' : 'INVESTIDOR_ONBOARDED',
          operador: 'self-service',
          privyId: input.privyId,
          payloadJson: {
            publicKey,
            etherfuseCustomerId: customer.id,
            kycStatus,
            papel: input.papel,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return upserted;
  });

  return {
    pessoaId: pessoa.id,
    publicKey,
    etherfuseCustomerId: customer.id,
    etherfuseBankAccountId: bankAccountId,
    kycStatus,
    kycAprovado: aprovado,
    cpfNormalizado,
    isSyntheticCpf,
    papeis: pessoa.papeis,
    fundedNow: fund.funded,
  };
}
