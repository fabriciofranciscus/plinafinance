/**
 * Fiação do pagamento ao cedente (E1-2). Contrato: contratos/2026-11-12-e1-2-fiacao-pagamento-cedente.md.
 *
 * Liga a porta de Pix de saída (`liquidacao-cedente.ts`) ao fluxo do funil SEM mexer em `originacao.ts`:
 * valor vem da oferta da cessão, teto `PIX_MAX_BRL`, SIMULADO em mainnet conta como NÃO pago, e só depois de
 * COMPROVADA (PSP em DONE + comprovante guardado + âncora) grava Pagamento, status do lead e EventoAudit
 * (`payloadHash` = SHA-256 do comprovante = Memo.hash da âncora). DB depois da chain. Sem PII.
 */
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { obterPixProvider } from '../integrations/psp';
import { validarChavePix, type PixProvider } from '../integrations/psp/types';
import { STELLAR_NETWORK } from '../stellar/config';
import { mascararDestino } from '../integrations/psp/comprovante';
import {
  LiquidacaoCedenteError,
  pagarTitular,
  reabrirTransferencia,
  type ResultadoPagamento,
} from './liquidacao-cedente';

export type PagamentoCedenteErrorCode =
  | 'CESSAO_NAO_ENCONTRADA'
  | 'CESSAO_NAO_ASSINADA'
  | 'CEDENTE_SEM_DOCUMENTO'
  | 'TITULAR_DIVERGE'
  | 'PAGAMENTO_JA_EXECUTADO'
  | 'TETO_NAO_CONFIGURADO'
  | 'ACIMA_DO_TETO'
  | 'SIMULADO_EM_MAINNET'
  | 'DESTINO_DIVERGE';

const MENSAGENS: Record<PagamentoCedenteErrorCode, string> = {
  CESSAO_NAO_ENCONTRADA: 'Pagamento ao cedente recusado: cessão não encontrada.',
  CESSAO_NAO_ASSINADA: 'Pagamento ao cedente recusado: a cessão precisa estar ASSINADA.',
  CEDENTE_SEM_DOCUMENTO: 'Pagamento ao cedente recusado: o cedente não tem CPF válido no cadastro.',
  TITULAR_DIVERGE: 'Pagamento ao cedente recusado: o CPF do cadastro do lead e o da conta do cedente divergem.',
  PAGAMENTO_JA_EXECUTADO: 'Pagamento ao cedente recusado: já executado para esta cessão.',
  TETO_NAO_CONFIGURADO: 'Pagamento ao cedente recusado: teto de valor não configurado.',
  ACIMA_DO_TETO: 'Pagamento ao cedente recusado: valor acima do teto.',
  SIMULADO_EM_MAINNET: 'Pagamento ao cedente recusado: Pix simulado não conta como pago em mainnet.',
  DESTINO_DIVERGE: 'Reabertura recusada: o destino do cadastro do cedente mudou desde a tentativa anterior (exige dupla aprovação).',
};

export class PagamentoCedenteError extends Error {
  constructor(readonly code: PagamentoCedenteErrorCode) {
    super(MENSAGENS[code]);
    this.name = 'PagamentoCedenteError';
  }
}

/** `PIX_MAX_BRL` (decimal em BRL). Ausente ou inválido = sem teto válido = recusa (fail-closed). */
function teto(): Prisma.Decimal {
  const bruto = (process.env.PIX_MAX_BRL ?? '').trim();
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(bruto) || Number(bruto) <= 0) {
    throw new PagamentoCedenteError('TETO_NAO_CONFIGURADO');
  }
  return new Prisma.Decimal(bruto);
}

export interface ResultadoPagamentoCedente {
  status: ResultadoPagamento['status'];
  pagamentoId?: string;
  sha256?: string;
  txHash?: string;
}

interface ContextoPagamento {
  cessaoId: string;
  leadVendedorId: string;
  cpf: string;
  valor: Prisma.Decimal;
  provider: PixProvider;
}

/**
 * Regras comuns a pagar e a reabrir: cessão ASSINADA e ainda não paga; destino = CPF do cedente da cessão; valor = oferta;
 * teto; simulado nunca em mainnet. Nada vem do chamador.
 */
async function contextoDoPagamento(cessaoId: string, provider?: PixProvider): Promise<ContextoPagamento> {
  const cessao = await db.cessao.findUnique({
    where: { id: cessaoId },
    select: {
      id: true,
      status: true,
      oferta: {
        select: {
          valorLiquidoVendedor: true,
          leadVendedorId: true,
          leadVendedor: { select: { cpf: true, pessoa: { select: { cpfNormalizado: true } } } },
        },
      },
      pagamento: { select: { status: true } },
    },
  });
  if (!cessao) throw new PagamentoCedenteError('CESSAO_NAO_ENCONTRADA');
  if (cessao.status !== 'ASSINADA') throw new PagamentoCedenteError('CESSAO_NAO_ASSINADA');
  if (cessao.pagamento?.status === 'EXECUTADO') throw new PagamentoCedenteError('PAGAMENTO_JA_EXECUTADO');

  // Titular: o CPF do cadastro do cedente (precisa ser válido); se a conta (Pessoa) também tem CPF, os dois têm de bater.
  const lead = cessao.oferta.leadVendedor;
  const cpf = lead?.cpf ? validarChavePix('CPF', lead.cpf) : null;
  if (!cpf) throw new PagamentoCedenteError('CEDENTE_SEM_DOCUMENTO');
  const cpfConta = lead?.pessoa?.cpfNormalizado?.replace(/\D/g, '');
  if (cpfConta && cpfConta !== cpf) throw new PagamentoCedenteError('TITULAR_DIVERGE');

  // O valor é o da oferta da cessão; nunca o que o chamador diz.
  const valor = new Prisma.Decimal(cessao.oferta.valorLiquidoVendedor);
  if (valor.gt(teto())) throw new PagamentoCedenteError('ACIMA_DO_TETO');

  const p = provider ?? obterPixProvider();
  if (p.nome === 'SIMULADO' && STELLAR_NETWORK === 'PUBLIC') {
    throw new PagamentoCedenteError('SIMULADO_EM_MAINNET'); // fail-closed: simulado nunca conta como pago em mainnet
  }
  return { cessaoId: cessao.id, leadVendedorId: cessao.oferta.leadVendedorId, cpf, valor, provider: p };
}

/**
 * Paga o cedente de uma cessão assinada. **O destino NÃO vem do chamador** (P2 do Argus, decisão do Atlas): a chave Pix
 * é a do tipo CPF do próprio cedente da cessão (o CPF do cadastro), então a titularidade bate por construção; chave de
 * outro tipo ou de outra pessoa não existe aqui (follow-up pós-D30, com dupla aprovação auditada). O CPF não é
 * persistido nem logado por este serviço. Idempotente: repetir devolve o estado, não paga de novo.
 */
export async function pagarCedenteDaCessao(
  input: { cessaoId: string; operador: string },
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamentoCedente> {
  const ctx = await contextoDoPagamento(input.cessaoId, opts.provider);
  const r = await pagarTitular(
    { cessaoId: ctx.cessaoId, valor: ctx.valor.toFixed(2), chavePix: ctx.cpf, tipoChave: 'CPF' },
    { provider: ctx.provider, agora: opts.agora },
  );
  if (r.status !== 'COMPROVADA') return { status: r.status, sha256: r.sha256, txHash: r.txHash };
  const { pagamentoId } = await fecharPagamento(ctx.cessaoId, input.operador);
  return { status: 'COMPROVADA', pagamentoId, sha256: r.sha256, txHash: r.txHash };
}

/**
 * REABRIR um pagamento (ação de admin AUDITADA; decisão do Atlas: F-E12-1 é ALTO no domínio, a cessão assinada com o
 * preço não pago deixa a Plina em atraso com o cedente). Só depois de FALHOU confirmado pelo PSP (recusa 4xx, FAILED ou
 * CANCELLED: nada saiu), com o MESMO destino do cadastro do cedente (se o cadastro mudou, recusa: destino diferente é
 * pós-D30 com dupla aprovação). A decisão é gravada em EventoAudit \`PIX_REAL_REABERTO\` ANTES do novo envio. Qualquer outro
 * estado (INCERTO, PROCESSANDO, COMPROVADA) não reabre: o dinheiro pode ter saído.
 */
export async function reabrirPagamentoCedente(
  input: { cessaoId: string; operador: string },
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamentoCedente> {
  const ctx = await contextoDoPagamento(input.cessaoId, opts.provider);
  const t = await db.transferenciaPix.findUnique({ where: { cessaoId: ctx.cessaoId } });
  if (!t) throw new LiquidacaoCedenteError('TRANSFERENCIA_NAO_ENCONTRADA');
  if (t.status !== 'FALHOU') throw new LiquidacaoCedenteError('NAO_REABRIVEL', t.status);
  if (t.destinoMascarado !== mascararDestino('CPF', ctx.cpf)) throw new PagamentoCedenteError('DESTINO_DIVERGE');

  // Auditoria da decisão (append-only), antes de qualquer envio. Só ids, hashes de tentativa e códigos; sem CPF.
  await db.eventoAudit.create({
    data: {
      acao: 'PIX_REAL_REABERTO',
      operador: input.operador,
      leadVendedorId: ctx.leadVendedorId,
      cessaoId: ctx.cessaoId,
      payloadJson: {
        cessaoId: ctx.cessaoId,
        provedor: t.provedor,
        tentativaAnterior: t.tentativa,
        tentativaNova: t.tentativa + 1,
        idempotencyKeyAnterior: t.idempotencyKey,
        motivoAnterior: t.motivoFalha,
        providerIdAnterior: t.providerId,
      } as Prisma.InputJsonValue,
    },
  });

  const r = await reabrirTransferencia(
    { cessaoId: ctx.cessaoId, valor: ctx.valor.toFixed(2), chavePix: ctx.cpf, tipoChave: 'CPF', operador: input.operador },
    { provider: ctx.provider, agora: opts.agora },
  );
  if (r.status !== 'COMPROVADA') return { status: r.status, sha256: r.sha256, txHash: r.txHash };
  const { pagamentoId } = await fecharPagamento(ctx.cessaoId, input.operador);
  return { status: 'COMPROVADA', pagamentoId, sha256: r.sha256, txHash: r.txHash };
}

/**
 * Grava Pagamento, status do lead e EventoAudit de uma transferência COMPROVADA. Idempotente: se o Pagamento já está
 * EXECUTADO não duplica nada. Chamado pelo fluxo do admin e pelo varredor (quando o PSP concluir depois).
 */
export async function fecharPagamento(
  cessaoId: string,
  operador = 'varredor-pix',
): Promise<{ criado: boolean; pagamentoId: string }> {
  const t = await db.transferenciaPix.findUnique({ where: { cessaoId } });
  if (!t || t.status !== 'COMPROVADA' || !t.comprovanteSha256 || !t.ancoraTxHash) {
    throw new LiquidacaoCedenteError('TRANSFERENCIA_NAO_ENCONTRADA');
  }
  const cessao = await db.cessao.findUnique({
    where: { id: cessaoId },
    select: { id: true, ofertaId: true, oferta: { select: { leadVendedorId: true } } },
  });
  if (!cessao) throw new PagamentoCedenteError('CESSAO_NAO_ENCONTRADA');

  return db.$transaction(async (tx) => {
    const atual = await tx.pagamento.findUnique({ where: { cessaoId }, select: { id: true, status: true } });
    if (atual?.status === 'EXECUTADO') return { criado: false, pagamentoId: atual.id };
    const dados = {
      metodo: t.provedor === 'SIMULADO' ? ('PIX_SIMULADO' as const) : ('PIX_REAL' as const),
      valor: t.valor,
      onChainTxHash: t.ancoraTxHash,
      executadoEm: new Date(),
      comprovanteUrl: t.comprovantePath,
      status: 'EXECUTADO' as const,
    };
    const pagamento = await tx.pagamento.upsert({
      where: { cessaoId },
      create: { cessaoId, ...dados },
      update: dados,
    });
    await tx.leadVendedor.update({ where: { id: cessao.oferta.leadVendedorId }, data: { status: 'PIX_EXECUTADO' } });
    await tx.eventoAudit.create({
      data: {
        acao: 'PIX_REAL_EXECUTADO',
        operador,
        leadVendedorId: cessao.oferta.leadVendedorId,
        cessaoId,
        payloadJson: {
          cessaoId,
          ofertaId: cessao.ofertaId,
          valor: t.valor.toFixed(2),
          provedor: t.provedor,
          transferenciaId: t.providerId,
          e2eId: t.e2eId,
          comprovanteSha256: t.comprovanteSha256,
        } as Prisma.InputJsonValue,
        payloadHash: t.comprovanteSha256,
        stellarTxHash: t.ancoraTxHash,
      },
    });
    return { criado: true, pagamentoId: pagamento.id };
  });
}
