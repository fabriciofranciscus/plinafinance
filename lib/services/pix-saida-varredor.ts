/**
 * Varredor do Pix de saída (E1-2). Chamado por agendador (`GET /api/ops/pix-saida`): retoma as transferências não
 * terminais SEM reenviar (`avancarTransferencia`), fecha as que viraram COMPROVADA (`fecharPagamento`) e calcula o
 * alerta de operação: VALOR_DIVERGE, qualquer INCERTO, ou PROCESSANDO/ENVIANDO há mais de 30 min. Só contagens e ids
 * internos de cessão; nada de PII. Contrato: contratos/2026-11-12-e1-2-fiacao-pagamento-cedente.md.
 */
import { db } from '../db';
import { avancarTransferencia, causaSegura } from './liquidacao-cedente';
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
    orderBy: { criadoEm: 'asc' },
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
    where: { status: { in: ['ENVIANDO', 'PROCESSANDO', 'INCERTO'] } },
    select: { cessaoId: true, status: true, motivoFalha: true, criadoEm: true, alertadoEm: true },
  });
  const corte = agora.getTime() - PROCESSANDO_ALERTA_MS;
  const emAlerta = aberto.filter(
    (t) => t.status === 'INCERTO' || t.motivoFalha === 'PSP_VALOR_DIVERGE' || t.criadoEm.getTime() < corte,
  );
  return {
    avancadas,
    comprovadas,
    erros,
    processando: aberto.filter((t) => t.status !== 'INCERTO').length,
    incertos: aberto.filter((t) => t.status === 'INCERTO').length,
    valorDiverge: aberto.filter((t) => t.motivoFalha === 'PSP_VALOR_DIVERGE').length,
    processandoAntigas: aberto.filter((t) => t.status !== 'INCERTO' && t.criadoEm.getTime() < corte).length,
    alerta: emAlerta.length > 0,
    paraAvisar: emAlerta.filter((t) => t.alertadoEm === null).map((t) => t.cessaoId),
  };
}

/** Marca como avisadas (só depois do e-mail ENTREGUE; senão o próximo ciclo avisa de novo). */
export async function marcarPixAvisados(cessaoIds: string[]): Promise<void> {
  if (cessaoIds.length === 0) return;
  await db.transferenciaPix.updateMany({ where: { cessaoId: { in: cessaoIds } }, data: { alertadoEm: new Date() } });
}
