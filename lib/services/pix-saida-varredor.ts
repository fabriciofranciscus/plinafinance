/**
 * Varredor do Pix de saída (E1-2). Chamado por agendador (`GET /api/ops/pix-saida`): retoma as transferências não
 * terminais SEM reenviar (`avancarTransferencia`), fecha as que viraram COMPROVADA (`fecharPagamento`) e calcula o
 * alerta de operação: VALOR_DIVERGE, qualquer INCERTO, PSP em DONE sem EndToEndId (PSP_SEM_E2E), FALHOU (cedente não pago, esperando a decisão de reabrir) ou PROCESSANDO/ENVIANDO há mais de 30 min (contados desde o início da tentativa ATUAL). Só contagens e ids
 * internos de cessão; nada de PII. Contrato: contratos/2026-11-12-e1-2-fiacao-pagamento-cedente.md.
 */
import { db } from '../db';
import type { TransferenciaPix } from '@prisma/client';
import { avancarTransferencia, causaSegura, inicioDaTentativa } from './liquidacao-cedente';
import { fecharPagamento } from './pagamento-cedente';

export const PROCESSANDO_ALERTA_MS = 30 * 60_000;
const LOTE = 20;

export interface ResultadoVarredorPix {
  avancadas: number;
  comprovadas: number;
  erros: number;
  processando: number;
  incertos: number;
  valorDiverge: number;
  /** FALHOU: o cedente continua sem receber; alerta até alguém reabrir ou decidir (F-FIA-4). */
  falhados: number;
  /** PSP em DONE sem EndToEndId: em conferência (Consuelo). */
  semE2eId: number;
  processandoAntigas: number;
  alerta: boolean;
  /** Cessões em alerta AINDA não avisadas por e-mail (ids internos). */
  paraAvisar: string[];
}

export async function varrerPixSaida(opts: { agora?: Date } = {}): Promise<ResultadoVarredorPix> {
  const agora = opts.agora ?? new Date();
  let avancadas = 0;
  let comprovadas = 0;
  let erros = 0;

  const abertas = await db.transferenciaPix.findMany({
    where: { status: { in: ['ENVIANDO', 'PROCESSANDO', 'INCERTO'] } },
    // As menos recentemente tocadas primeiro: cada tentativa atualiza `atualizadoEm`, então as travadas rotacionam e
    // não ocupam o lote para sempre (F-FIA-7).
    orderBy: { atualizadoEm: 'asc' },
    take: LOTE,
    select: { cessaoId: true },
  });
  for (const { cessaoId } of abertas) {
    try {
      const r = await avancarTransferencia(cessaoId, { agora });
      avancadas++;
      if (r.status === 'COMPROVADA') {
        await fecharPagamento(cessaoId);
        comprovadas++;
      }
    } catch (err) {
      erros++; // EM_ANDAMENTO (outra execução), ANCORA_FALHOU, COMPROVANTE_FALHOU, VALOR_DIVERGE…
      console.error('[pix-saida] avanço falhou', causaSegura(err));
    }
  }

  // Comprovadas que ainda não viraram Pagamento (queda entre a âncora e o fechamento): fecha (idempotente).
  const comprovadasRecentes = await db.transferenciaPix.findMany({
    where: { status: 'COMPROVADA' },
    orderBy: { atualizadoEm: 'desc' },
    take: LOTE,
    select: { cessaoId: true },
  });
  for (const { cessaoId } of comprovadasRecentes) {
    try {
      const r = await fecharPagamento(cessaoId);
      if (r.criado) comprovadas++;
    } catch (err) {
      erros++;
      console.error('[pix-saida] fechamento falhou', causaSegura(err));
    }
  }

  const aberto = await db.transferenciaPix.findMany({
    where: { status: { in: ['ENVIANDO', 'PROCESSANDO', 'INCERTO', 'FALHOU'] } },
    select: { cessaoId: true, status: true, motivoFalha: true, criadoEm: true, historico: true, alertadoEm: true },
  });
  const corte = agora.getTime() - PROCESSANDO_ALERTA_MS;
  // Idade desde o início da tentativa ATUAL (a reabertura zera o relógio; F-FIA-5).
  const antiga = (t: (typeof aberto)[number]) =>
    inicioDaTentativa({ historico: t.historico, criadoEm: t.criadoEm } as unknown as TransferenciaPix).getTime() < corte;
  const emTransito = (t: (typeof aberto)[number]) => t.status === 'ENVIANDO' || t.status === 'PROCESSANDO';
  const emAlerta = aberto.filter(
    (t) =>
      t.status === 'INCERTO' ||
      t.status === 'FALHOU' ||
      t.motivoFalha === 'PSP_VALOR_DIVERGE' ||
      t.motivoFalha === 'PSP_SEM_E2E' ||
      (emTransito(t) && antiga(t)),
  );
  return {
    avancadas,
    comprovadas,
    erros,
    processando: aberto.filter(emTransito).length,
    incertos: aberto.filter((t) => t.status === 'INCERTO').length,
    valorDiverge: aberto.filter((t) => t.motivoFalha === 'PSP_VALOR_DIVERGE').length,
    semE2eId: aberto.filter((t) => t.motivoFalha === 'PSP_SEM_E2E').length,
    falhados: aberto.filter((t) => t.status === 'FALHOU').length,
    processandoAntigas: aberto.filter((t) => emTransito(t) && antiga(t)).length,
    alerta: emAlerta.length > 0,
    paraAvisar: emAlerta.filter((t) => t.alertadoEm === null).map((t) => t.cessaoId),
  };
}

/** Marca como avisadas (só depois do e-mail ENTREGUE; senão o próximo ciclo avisa de novo). */
export async function marcarPixAvisados(cessaoIds: string[]): Promise<void> {
  if (cessaoIds.length === 0) return;
  await db.transferenciaPix.updateMany({ where: { cessaoId: { in: cessaoIds } }, data: { alertadoEm: new Date() } });
}
