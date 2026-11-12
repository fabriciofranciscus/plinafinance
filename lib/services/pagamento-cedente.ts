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
import type { PixProvider, TipoChavePix } from '../integrations/psp/types';
import { STELLAR_NETWORK } from '../stellar/config';
import {
  LiquidacaoCedenteError,
  pagarTitular,
  type ResultadoPagamento,
} from './liquidacao-cedente';

export type PagamentoCedenteErrorCode =
  | 'CESSAO_NAO_ENCONTRADA'
  | 'CESSAO_NAO_ASSINADA'
  | 'PAGAMENTO_JA_EXECUTADO'
  | 'TETO_NAO_CONFIGURADO'
  | 'ACIMA_DO_TETO'
  | 'SIMULADO_EM_MAINNET';

const MENSAGENS: Record<PagamentoCedenteErrorCode, string> = {
  CESSAO_NAO_ENCONTRADA: 'Pagamento ao cedente recusado: cessão não encontrada.',
  CESSAO_NAO_ASSINADA: 'Pagamento ao cedente recusado: a cessão precisa estar ASSINADA.',
  PAGAMENTO_JA_EXECUTADO: 'Pagamento ao cedente recusado: já executado para esta cessão.',
  TETO_NAO_CONFIGURADO: 'Pagamento ao cedente recusado: teto de valor não configurado.',
  ACIMA_DO_TETO: 'Pagamento ao cedente recusado: valor acima do teto.',
  SIMULADO_EM_MAINNET: 'Pagamento ao cedente recusado: Pix simulado não conta como pago em mainnet.',
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

/**
 * Paga o cedente de uma cessão assinada. A chave Pix vem na chamada (operador) e não é persistida. Idempotente:
 * repetir devolve o estado, não paga de novo.
 */
export async function pagarCedenteDaCessao(
  input: { cessaoId: string; chavePix: string; tipoChave: TipoChavePix; operador: string },
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamentoCedente> {
  const cessao = await db.cessao.findUnique({
    where: { id: input.cessaoId },
    select: { id: true, status: true, oferta: { select: { valorLiquidoVendedor: true } }, pagamento: { select: { status: true } } },
  });
  if (!cessao) throw new PagamentoCedenteError('CESSAO_NAO_ENCONTRADA');
  if (cessao.status !== 'ASSINADA') throw new PagamentoCedenteError('CESSAO_NAO_ASSINADA');
  if (cessao.pagamento?.status === 'EXECUTADO') throw new PagamentoCedenteError('PAGAMENTO_JA_EXECUTADO');

  // O valor é o da oferta da cessão; nunca o que o chamador diz.
  const valor = new Prisma.Decimal(cessao.oferta.valorLiquidoVendedor);
  if (valor.gt(teto())) throw new PagamentoCedenteError('ACIMA_DO_TETO');

  const provider = opts.provider ?? obterPixProvider();
  if (provider.nome === 'SIMULADO' && STELLAR_NETWORK === 'PUBLIC') {
    throw new PagamentoCedenteError('SIMULADO_EM_MAINNET'); // fail-closed: simulado nunca conta como pago em mainnet
  }

  const r = await pagarTitular(
    { cessaoId: cessao.id, valor: valor.toFixed(2), chavePix: input.chavePix, tipoChave: input.tipoChave },
    { provider, agora: opts.agora },
  );
  if (r.status !== 'COMPROVADA') return { status: r.status, sha256: r.sha256, txHash: r.txHash };
  const { pagamentoId } = await fecharPagamento(cessao.id, input.operador);
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
