/**
 * Etapas do operador no /admin (spec de UX da Íris, §4.3 e §4.4). Função pura: dado um lead, devolve as 10 etapas
 * com a situação de cada uma (feita / agora / futura) e a única "próxima ação". As ACTIONS e as pré-condições são as
 * de POST /api/admin/originacao; esta regra só decide o que mostrar, o servidor continua sendo quem recusa.
 */

import type { LeadAdmin } from './tipos';

export type IdEtapa =
  | 'proposta'
  | 'aceite'
  | 'cessao'
  | 'laudo'
  | 'envio'
  | 'assinatura'
  | 'titular'
  | 'anuencia'
  | 'pagamento'
  | 'incorporacao';

export type SituacaoEtapa = 'feita' | 'agora' | 'futura';

export interface EtapaOperador {
  n: number;
  id: IdEtapa;
  rotulo: string;
  situacao: SituacaoEtapa;
  /** Data real da etapa, quando o servidor a tem. */
  data: string | Date | null;
  /** Evidência (hash/tx/id) da etapa feita. */
  evidencia: { tx?: string; hash?: string; texto?: string } | null;
  /** Etapa "agora" que depende do cedente (sem botão primário). */
  aguardaCedente: boolean;
  /** Pré-condição de uma etapa futura, em texto. */
  depoisDe: string | null;
}

export type EstadoSolicitacao = 'aberta' | 'concluida' | 'encerrada' | 'manual';
export type SubEstadoPagamento = 'pagar' | 'reconsultar' | 'reabrir';

export interface AnaliseSolicitacao {
  etapas: EtapaOperador[];
  /** n da etapa "agora" (null se concluída, encerrada, manual ou sem ação). */
  atual: number | null;
  estado: EstadoSolicitacao;
  /** Rótulo curto da próxima ação, para a lista. "—" quando não há. */
  proximaAcao: string;
  dependeDe: 'operador' | 'cedente' | 'ninguem';
  /** Para a etapa de pagamento: pagar, reconsultar (Pix em andamento) ou reabrir (FALHOU). */
  pagamento: SubEstadoPagamento;
  /** Razão de uma pausa sem "agora" (oferta recusada/expirada, tratamento manual). */
  pausa: string | null;
}

const ROTULO: Record<IdEtapa, string> = {
  proposta: 'Proposta gerada',
  aceite: 'Proposta aceita pelo cedente',
  cessao: 'Cessão registrada',
  laudo: 'Laudo registrado',
  envio: 'Enviada para assinatura',
  assinatura: 'Cessão assinada',
  titular: 'Titular do laudo confirmado',
  anuencia: 'Anuência da administradora',
  pagamento: 'Pagamento ao cedente',
  incorporacao: 'Cota incorporada ao pool',
};

/** Nome da etapa EM ANDAMENTO (presente), para a coluna "Etapa" e o título do detalhe; o `rotulo` acima é o da etapa feita. */
export const NOME_EM_ANDAMENTO: Record<IdEtapa, string> = {
  proposta: 'Proposta',
  aceite: 'Aceite do cedente',
  cessao: 'Cessão',
  laudo: 'Laudo',
  envio: 'Envio para assinatura',
  assinatura: 'Assinatura do cedente',
  titular: 'Titular do laudo',
  anuencia: 'Anuência da administradora',
  pagamento: 'Pagamento ao cedente',
  incorporacao: 'Incorporação da cota',
};

const ORDEM: IdEtapa[] = ['proposta', 'aceite', 'cessao', 'laudo', 'envio', 'assinatura', 'titular', 'anuencia', 'pagamento', 'incorporacao'];

const PIX_EM_ANDAMENTO = ['ENVIANDO', 'PROCESSANDO', 'INCERTO'];

export function etapasDoLead(lead: LeadAdmin, opcoes: { redePublica?: boolean } = {}): AnaliseSolicitacao {
  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  const pagamento = cessao?.pagamento ?? null;
  const cota = cessao?.cota ?? null;
  const encerrado = lead.status === 'PERDIDO';
  const titularUnico = cessao?.titularSituacao === 'TITULAR_UNICO';
  const titularManual = !!cessao?.titularSituacao && !titularUnico;
  const pixOk = cessao?.pixStatus === 'COMPROVADA' || pagamento?.status === 'EXECUTADO';

  const feita: Record<IdEtapa, boolean> = {
    proposta: !!oferta,
    aceite: oferta?.status === 'ACEITA' || !!cessao,
    cessao: !!cessao,
    laudo: !!cessao?.laudoRegistrado,
    envio: cessao?.status === 'ENVIADA_DOCUSIGN' || cessao?.status === 'ASSINADA',
    assinatura: cessao?.status === 'ASSINADA',
    titular: !!cessao?.titularSituacao,
    anuencia: !!cessao?.anuenciaStatus,
    pagamento: pixOk,
    incorporacao: !!cota,
  };

  const dados: Record<IdEtapa, Pick<EtapaOperador, 'data' | 'evidencia'>> = {
    proposta: { data: oferta?.criadaEm ?? null, evidencia: null },
    aceite: { data: null, evidencia: null },
    cessao: { data: cessao?.criadaEm ?? null, evidencia: null },
    laudo: { data: cessao?.laudoEm ?? null, evidencia: cessao?.laudoHash ? { hash: cessao.laudoHash } : null },
    envio: { data: cessao?.envioEm ?? null, evidencia: null },
    assinatura: { data: cessao?.assinadaEm ?? null, evidencia: cessao?.onChainTxHash ? { tx: cessao.onChainTxHash } : null },
    titular: { data: null, evidencia: cessao?.titularSituacao ? { texto: cessao.titularSituacao } : null },
    anuencia: { data: cessao?.anuenciaEm ?? null, evidencia: cessao?.anuenciaStatus ? { texto: cessao.anuenciaStatus } : null },
    pagamento: { data: cessao?.pagamentoEm ?? null, evidencia: pagamento?.onChainTxHash ? { tx: pagamento.onChainTxHash } : null },
    incorporacao: { data: cessao?.cotaEm ?? null, evidencia: cota ? { texto: cota.id } : null },
  };

  // Primeira etapa não feita = "agora", salvo as pausas abaixo.
  let atual: IdEtapa | null = null;
  let pausa: string | null = null;
  let estado: EstadoSolicitacao = 'aberta';

  const primeira = ORDEM.find((id) => !feita[id]) ?? null;
  if (!primeira) estado = 'concluida';
  else if (encerrado) estado = 'encerrada';
  else if (titularManual) {
    estado = 'manual';
    pausa = 'Fora do fluxo automático. Tratamento manual pela equipe.';
  } else if (primeira === 'aceite' && oferta && oferta.status !== 'ENVIADA') {
    // Oferta rascunho/recusada/expirada: não há ação do operador nesta linha reta.
    pausa = `Proposta ${oferta.status.toLowerCase()}: não há ação nesta etapa.`;
  } else {
    atual = primeira;
  }
  // Etapas seguintes ao tratamento manual não ficam "agora".
  if (estado === 'manual') atual = null;

  const etapas: EtapaOperador[] = ORDEM.map((id, i) => {
    const n = i + 1;
    const situacao: SituacaoEtapa = feita[id] ? 'feita' : id === atual ? 'agora' : 'futura';
    return {
      n,
      id,
      rotulo: ROTULO[id],
      situacao,
      data: situacao === 'feita' ? dados[id].data : null,
      evidencia: situacao === 'feita' ? dados[id].evidencia : null,
      aguardaCedente: situacao === 'agora' && (id === 'aceite' || id === 'assinatura'),
      depoisDe: situacao === 'futura' && i > 0 ? `depois da etapa ${i}` : null,
    };
  });

  const subPagamento: SubEstadoPagamento =
    cessao?.pixStatus === 'FALHOU' ? 'reabrir' : cessao?.pixStatus && PIX_EM_ANDAMENTO.includes(cessao.pixStatus) ? 'reconsultar' : 'pagar';

  const simulado = !opcoes.redePublica;
  const rotuloAcao: Record<IdEtapa, string> = {
    proposta: 'Gerar proposta',
    aceite: 'Aguardando o cedente',
    cessao: 'Registrar cessão',
    laudo: 'Registrar laudo',
    envio: 'Enviar para assinatura',
    assinatura: 'Aguardando assinatura do cedente',
    titular: 'Confirmar titular',
    anuencia: 'Registrar anuência',
    pagamento:
      subPagamento === 'reabrir' ? 'Reabrir pagamento' : subPagamento === 'reconsultar' ? 'Reconsultar pagamento' : simulado ? 'Pagar cedente (Pix simulado)' : 'Pagar cedente (Pix)',
    incorporacao: 'Incorporar cota',
  };

  const proximaAcao = atual ? rotuloAcao[atual] : estado === 'concluida' ? 'Concluída' : estado === 'encerrada' ? 'Encerrada' : estado === 'manual' ? 'Tratamento manual' : '—';
  const dependeDe = !atual ? 'ninguem' : atual === 'aceite' || atual === 'assinatura' ? 'cedente' : 'operador';

  return { etapas, atual: atual ? ORDEM.indexOf(atual) + 1 : null, estado, proximaAcao, dependeDe, pagamento: subPagamento, pausa };
}

/** Ordem da lista: dependem do operador primeiro, depois aguardam o cedente; dentro do grupo, a mais antiga primeiro. */
export function ordenarSolicitacoes<T extends LeadAdmin>(leads: T[], opcoes: { redePublica?: boolean } = {}): T[] {
  const peso = (l: T) => {
    const a = etapasDoLead(l, opcoes);
    return a.estado !== 'aberta' ? 2 : a.dependeDe === 'operador' ? 0 : 1;
  };
  return [...leads].sort((a, b) => peso(a) - peso(b) || new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());
}
