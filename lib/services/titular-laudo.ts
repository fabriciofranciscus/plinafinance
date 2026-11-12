/**
 * Titular confirmado no laudo de validação (E1-2, condição da Consuelo aceita pelo Atlas): o documento do cadastro do
 * cedente (`LeadVendedor.cpf`) tem de bater com o titular confirmado no laudo; se divergir, não há pagamento. Espólio,
 * cotitularidade e procurador ficam FORA do fluxo automático (tratamento manual).
 *
 * Só se guarda um HMAC-SHA256 do documento com segredo do servidor (`TITULAR_HMAC_SECRET`, ≥ 32 caracteres): um hash
 * simples de CPF é reversível por força bruta. O documento em claro nunca vai ao banco, ao audit nem ao log. Esta etapa
 * é separada de `registrarLaudoDaCessao` (originacao.ts, Bento): o operador a chama depois de conferir o laudo.
 * Contrato: contratos/2026-11-12-e1-2-fiacao-pagamento-cedente.md.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { validarChavePix } from '../integrations/psp/types';

export const SEGREDO_TITULAR_MIN = 32;
export const SITUACOES_TITULAR = ['TITULAR_UNICO', 'ESPOLIO', 'COTITULARIDADE', 'PROCURADOR'] as const;
export type SituacaoTitular = (typeof SITUACOES_TITULAR)[number];

export type TitularLaudoErrorCode =
  | 'SEGREDO_NAO_CONFIGURADO'
  | 'ENTRADA_INVALIDA'
  | 'CEDENTE_SEM_DOCUMENTO'
  | 'CESSAO_NAO_ENCONTRADA'
  | 'PAGAMENTO_EM_CURSO'
  | 'TITULAR_NAO_CONFIRMADO'
  | 'TITULAR_DIVERGE_LAUDO'
  | 'TRATAMENTO_MANUAL';

const MENSAGENS: Record<TitularLaudoErrorCode, string> = {
  SEGREDO_NAO_CONFIGURADO: 'Titular do laudo indisponível: segredo de conferência não configurado.',
  ENTRADA_INVALIDA: 'Titular do laudo recusado: entrada inválida ou atestado ausente.',
  CEDENTE_SEM_DOCUMENTO: 'Titular do laudo recusado: o cedente não tem conta verificada com CPF válido ligada ao lead.',
  CESSAO_NAO_ENCONTRADA: 'Titular do laudo recusado: cessão não encontrada.',
  PAGAMENTO_EM_CURSO: 'Titular do laudo não pode mais mudar: já existe pagamento para esta cessão.',
  TITULAR_NAO_CONFIRMADO: 'Pagamento recusado: o titular do laudo ainda não foi confirmado.',
  TITULAR_DIVERGE_LAUDO: 'Pagamento recusado: o documento do cadastro difere do titular confirmado no laudo.',
  TRATAMENTO_MANUAL: 'Pagamento recusado: espólio, cotitularidade ou procurador exigem tratamento manual.',
};

export class TitularLaudoError extends Error {
  constructor(readonly code: TitularLaudoErrorCode) {
    super(MENSAGENS[code]);
    this.name = 'TitularLaudoError';
  }
}

function segredo(): string {
  const s = (process.env.TITULAR_HMAC_SECRET ?? '').trim();
  if (s.length < SEGREDO_TITULAR_MIN) throw new TitularLaudoError('SEGREDO_NAO_CONFIGURADO');
  return s;
}

/** HMAC-SHA256 (hex) do documento só com dígitos, vinculado à cessão (o mesmo CPF em outra cessão dá outro HMAC). */
export function hmacDoDocumento(cessaoId: string, documento: string): string {
  return createHmac('sha256', segredo()).update(`${cessaoId}:${documento}`).digest('hex');
}

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Documento normalizado (CPF 11 / CNPJ 14, dígitos verificadores válidos) ou null. */
export function documentoValido(bruto: string): string | null {
  const d = bruto.replace(/\D/g, '');
  const tipo = d.length === 11 ? 'CPF' : d.length === 14 ? 'CNPJ' : null;
  return tipo ? validarChavePix(tipo, d) : null;
}

/**
 * No registro da validação legal da cota, o OPERADOR ATESTA que o titular confirmado no laudo da administradora é o CPF
 * do cadastro do cedente (Consuelo/Atlas, 12/11). Ninguém digita o CPF: o sistema lê o da Pessoa com KYC ligada ao lead
 * e grava só o HMAC dele e a situação; o `EventoAudit` `TITULAR_LAUDO_CONFIRMADO` leva o hash (HMAC), nunca o CPF.
 * Sem o atestado (`atestado: true`) nada é gravado e não há pagamento. Não muda depois que existe pagamento.
 */
export async function confirmarTitularDoLaudo(input: {
  cessaoId: string;
  situacao: SituacaoTitular;
  /** O operador atesta: "titular confirmado no laudo = CPF do cadastro do cedente". */
  atestado: boolean;
  operador: string;
}): Promise<{ situacao: SituacaoTitular; pagamentoAutomatico: boolean }> {
  if (
    input.atestado !== true ||
    !SITUACOES_TITULAR.includes(input.situacao) ||
    typeof input.operador !== 'string' ||
    !/^[A-Za-z0-9:_.-]{1,80}$/.test(input.operador) ||
    !input.cessaoId
  ) {
    throw new TitularLaudoError('ENTRADA_INVALIDA');
  }
  segredo(); // falha antes de tocar o banco se faltar o segredo
  const cessao = await db.cessao.findUnique({
    where: { id: input.cessaoId },
    select: {
      id: true,
      oferta: {
        select: {
          leadVendedorId: true,
          leadVendedor: { select: { pessoa: { select: { cpfNormalizado: true, kycAprovado: true, isSyntheticCpf: true } } } },
        },
      },
    },
  });
  if (!cessao) throw new TitularLaudoError('CESSAO_NAO_ENCONTRADA');
  // O CPF atestado é o da conta verificada (a mesma fonte que o pagamento usa); sem ele não há o que atestar.
  const pessoa = cessao.oferta.leadVendedor?.pessoa;
  const documento = pessoa?.cpfNormalizado ? validarChavePix('CPF', pessoa.cpfNormalizado) : null;
  if (!pessoa || !documento || !pessoa.kycAprovado || pessoa.isSyntheticCpf) {
    throw new TitularLaudoError('CEDENTE_SEM_DOCUMENTO');
  }
  if (await db.transferenciaPix.findUnique({ where: { cessaoId: cessao.id }, select: { id: true } })) {
    throw new TitularLaudoError('PAGAMENTO_EM_CURSO');
  }
  const hmac = hmacDoDocumento(cessao.id, documento);
  await db.$transaction(async (tx) => {
    await tx.cessao.update({ where: { id: cessao.id }, data: { titularDocHmac: hmac, titularSituacao: input.situacao } });
    await tx.eventoAudit.create({
      data: {
        acao: 'TITULAR_LAUDO_CONFIRMADO',
        operador: input.operador,
        leadVendedorId: cessao.oferta.leadVendedorId,
        cessaoId: cessao.id,
        payloadJson: {
          cessaoId: cessao.id,
          situacao: input.situacao,
          atestado: 'TITULAR_CONFIRMADO_IGUAL_AO_CPF_DO_CADASTRO',
          tipoDocumento: 'CPF',
          documentoHmac: hmac, // hash, nunca o CPF
        } as Prisma.InputJsonValue,
      },
    });
  });
  return { situacao: input.situacao, pagamentoAutomatico: input.situacao === 'TITULAR_UNICO' };
}

/**
 * Confere, antes de pagar ou reabrir, que o documento do cadastro é o titular confirmado no laudo e que a situação
 * permite pagamento automático. Lança erro próprio (`TitularLaudoError`); quem chama alerta o operador.
 */
export function exigirTitularDoLaudo(
  cessao: { id: string; titularDocHmac: string | null; titularSituacao: string | null },
  documentoDoCadastro: string,
): void {
  if (!cessao.titularDocHmac || !cessao.titularSituacao) throw new TitularLaudoError('TITULAR_NAO_CONFIRMADO');
  if (cessao.titularSituacao !== 'TITULAR_UNICO') throw new TitularLaudoError('TRATAMENTO_MANUAL');
  if (!iguais(cessao.titularDocHmac, hmacDoDocumento(cessao.id, documentoDoCadastro))) {
    throw new TitularLaudoError('TITULAR_DIVERGE_LAUDO');
  }
}
