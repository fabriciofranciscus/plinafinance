/**
 * "Próxima ação" do /inicio (spec §2.3) e linha de "Em andamento" (§2.4).
 * Função pura: uma ação por vez, a primeira que valer. Sem cálculo de valores.
 */

import { NOME_ETAPA, STATUS_ABERTOS, TOTAL_ETAPAS } from './vocabulario';
import type { ResumoDaConta, SolicitacaoResumo } from './tipos';

export const idCurtoSolicitacao = (id: string) => id.slice(-6).toUpperCase();

export type ProximaAcao =
  | { caso: 1 | 2 | 3; titulo: string; apoio: string; botao: string; href: string; escuro: true }
  | { caso: 4; titulo: string; apoio: string; botao: string; href: string; escuro: true }
  | { caso: 5 | 6; titulo: string; apoio: string | null; href: string | null; escuro: false }
  | { caso: 7; titulo: string; apoio: string; escuro: false; dois: true }
  | { caso: 'bloqueio'; titulo: string; apoio: string; botao: string; href: string; escuro: true }
  | { caso: 'suspensa'; titulo: string; apoio: string; escuro: false };

const acompanhar = (id: string) => `/vender/acompanhar/${id}`;

function fmtValidade(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Válida até ${dia}, ${hora}.`;
}

const temSaldo = (r: ResumoDaConta) => !!r.posicao && Number(r.posicao.tokens) > 0;

export function proximaAcao(r: ResumoDaConta): ProximaAcao {
  if (r.bloqueio?.motivo === 'conta_suspensa') {
    return {
      caso: 'suspensa',
      titulo: 'Sua conta está com restrição',
      apoio: 'Fale com a equipe em contato@plina.finance.',
      escuro: false,
    };
  }
  if (r.bloqueio?.motivo === 'kyc_pendente') {
    // A verificação começa no fluxo de quem chega: cedente puro em /vender, o resto em /investir.
    const soCedente = r.papeis.includes('CEDENTE') && !r.papeis.includes('INVESTIDOR');
    return {
      caso: 'bloqueio',
      titulo: 'Concluir a verificação de identidade',
      apoio: 'Investir e sacar ficam indisponíveis até a verificação terminar.',
      botao: 'Continuar a verificação',
      href: soCedente ? '/vender' : '/investir',
      escuro: true,
    };
  }

  const abertas = r.solicitacoes.filter((s) => STATUS_ABERTOS.includes(s.status));
  const proposta = abertas
    .filter((s) => s.status === 'OFERTA_ENVIADA')
    .sort((a, b) => (a.ofertaValidade ?? '9').localeCompare(b.ofertaValidade ?? '9'))[0];
  if (proposta) {
    return {
      caso: 1,
      titulo: `Responder à proposta da solicitação #${idCurtoSolicitacao(proposta.id)}`,
      apoio: fmtValidade(proposta.ofertaValidade),
      botao: 'Ver proposta',
      href: acompanhar(proposta.id),
      escuro: true,
    };
  }
  const assinar = abertas.find((s) => s.status === 'OFERTA_ACEITA' && s.cessaoStatus === 'ENVIADA_DOCUSIGN');
  if (assinar) {
    return {
      caso: 2,
      titulo: `Assinar a cessão da solicitação #${idCurtoSolicitacao(assinar.id)}`,
      apoio: 'A assinatura é feita pelo link que a equipe enviou por e-mail. Verifique a caixa de spam.',
      botao: 'Abrir acompanhamento',
      href: acompanhar(assinar.id),
      escuro: true,
    };
  }
  const docs = abertas.find((s) => s.status === 'DOCS_SOLICITADOS');
  if (docs) {
    return {
      caso: 3,
      titulo: `Enviar os documentos da solicitação #${idCurtoSolicitacao(docs.id)}`,
      apoio: 'A lista foi enviada por e-mail.',
      botao: 'Abrir acompanhamento',
      href: acompanhar(docs.id),
      escuro: true,
    };
  }
  const op = r.operacoesPendentes[0];
  if (op) {
    const entrada = op.tipo === 'entrada';
    return {
      caso: 4,
      titulo: entrada ? 'Concluir a entrada no pool' : 'Concluir a saída do pool',
      apoio: `Valor: ${op.valor}. Pix simulado, rede de testes.`,
      botao: 'Continuar',
      href: op.continuarEm,
      escuro: true,
    };
  }
  if (abertas.length > 0) {
    const s = abertas[0]!;
    return {
      caso: 5,
      titulo: 'Nenhuma ação sua agora',
      apoio: `A equipe está cuidando da solicitação #${idCurtoSolicitacao(s.id)}. Você é avisado por e-mail a cada avanço.`,
      href: acompanhar(s.id),
      escuro: false,
    };
  }
  if (temSaldo(r)) {
    return { caso: 6, titulo: 'Nenhuma ação pendente', apoio: null, href: null, escuro: false };
  }
  return {
    caso: 7,
    titulo: 'Escolha por onde começar',
    apoio: 'Você pode investir no pool em rede de testes ou vender uma cota contemplada.',
    escuro: false,
    dois: true,
  };
}

export interface LinhaAndamento {
  etapa: string;
  quemAge: string;
}

/** Linha "Etapa N de 6 · nome" + "quem age" (§2.4). */
export function linhaAndamento(s: SolicitacaoResumo): LinhaAndamento {
  const n = s.etapa + 1;
  const nome = NOME_ETAPA[s.etapa] ?? '';
  const etapa = `Etapa ${n} de ${TOTAL_ETAPAS}${nome ? ` · ${nome}` : ''}`;
  const validade = s.ofertaValidade
    ? ` · válida até ${new Date(s.ofertaValidade).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
    : '';
  switch (s.status) {
    case 'NOVO':
    case 'CONTATADO':
      return { etapa, quemAge: 'Com a equipe · em validação' };
    case 'DOCS_SOLICITADOS':
      return { etapa, quemAge: 'Aguardando seus documentos' };
    case 'DOCS_RECEBIDOS':
      return { etapa, quemAge: 'Com a equipe · preparando a proposta' };
    case 'OFERTA_ENVIADA':
      return { etapa, quemAge: `Aguardando sua resposta${validade}` };
    case 'OFERTA_ACEITA':
      return {
        etapa,
        quemAge: s.cessaoStatus === 'ENVIADA_DOCUSIGN' ? 'Aguardando sua assinatura' : 'Com a equipe · preparando a cessão',
      };
    case 'CESSAO_ASSINADA':
      return { etapa, quemAge: 'Com a equipe · Pix sem prazo garantido' };
    case 'PIX_EXECUTADO':
      return { etapa: 'Concluída', quemAge: 'Pix enviado · cota em incorporação' };
    default:
      return { etapa: 'Encerrada', quemAge: '' };
  }
}
