/**
 * Tradução do erro de uma ação do /admin (POST /api/admin/originacao) para texto ao operador (checklist do item 14).
 * Código conhecido: mensagem segura da API + código numa segunda linha. Sem código e 5xx/rede: o resultado é
 * INCERTO ("a ação pode ter sido executada"), nunca "falhou com certeza". Não mostra campos além de `error` e `code`.
 */

export interface ErroDeAcao {
  texto: string;
  /** Código técnico para o operador copiar (segunda linha, mono). */
  codigo: string | null;
  /** Resultado incerto: conferir antes de repetir uma ação financeira. */
  incerto: boolean;
}

export const TEXTO_INCERTO =
  'Não foi possível confirmar o resultado. A ação pode ter sido executada: recarregue a página e confira antes de repetir.';

/**
 * "O que fazer" (GUIA admin §4, item 3) pelo código do servidor. Só os códigos da prévia/geração de proposta, cuja
 * condição vem da própria mensagem da API (lib/services/originacao.ts); código desconhecido: sem linha.
 */
const O_QUE_FAZER: Record<string, string> = {
  DESAGIO_TOTAL_EXCEDE: 'Reduza o deságio base ou o prazo restante e peça a prévia de novo.',
  DESAGIO_BASE_INVALIDO: 'Informe o deságio como fração entre 0 e 1 (ex.: 0.20 para 20%).',
  VALOR_CARTA_INVALIDO: 'Informe um valor de carta maior que zero.',
};
export function oQueFazer(codigo: string | null | undefined): string | null {
  return (codigo && O_QUE_FAZER[codigo]) || null;
}

export function interpretarErroDeAcao(status: number, corpo: unknown, retryAfter?: string | null): ErroDeAcao {
  const j = (corpo && typeof corpo === 'object' ? corpo : {}) as { error?: unknown; code?: unknown };
  const mensagem = typeof j.error === 'string' && j.error.trim() ? j.error.trim() : null;
  const codigo = typeof j.code === 'string' && j.code ? j.code : null;

  if (status === 401) return { texto: 'Sessão expirada. Entre novamente para continuar.', codigo: null, incerto: false };
  if (status === 403) return { texto: 'Acesso não autorizado.', codigo: null, incerto: false };
  if (status === 429) {
    const s = Number(retryAfter);
    return {
      texto: Number.isFinite(s) && s > 0 ? `Muitas tentativas. Aguarde ${Math.ceil(s)} s e tente de novo.` : 'Muitas tentativas. Aguarde um momento e tente de novo.',
      codigo: null,
      incerto: false,
    };
  }
  // 4xx e 503 com mensagem da API (inclui o 422 do deságio e o 503 DOCUSIGN_*): a mensagem é fixa e segura.
  if (mensagem && (status < 500 || status === 503)) return { texto: mensagem, codigo, incerto: false };
  if (status >= 500 || status === 0) return { texto: TEXTO_INCERTO, codigo, incerto: true };
  return { texto: `Falha ao executar a ação (HTTP ${status}).`, codigo, incerto: false };
}

/**
 * Respostas 200 que NÃO são o sucesso do passo (mapa do Bento, §4.5): `sincronizar-cessoes` devolve o resultado por
 * cessão e `pagar-cedente` o status do Pix. Devolve um aviso (não é erro) ou null quando o passo de fato avançou.
 */
export function avisoDeResposta(action: string, corpo: unknown): string | null {
  const j = (corpo && typeof corpo === 'object' ? corpo : {}) as { resultados?: Array<{ resultado?: string }>; status?: string };
  if (action === 'sincronizar-cessoes') {
    const r = j.resultados?.[0]?.resultado;
    if (!r) return 'Nenhuma cessão pendente de assinatura para sincronizar.';
    if (r === 'AGUARDANDO' || r === 'EM_ANDAMENTO') return 'O cedente ainda não assinou. Tente sincronizar mais tarde.';
    if (r === 'CANCELADA') return 'A cessão foi cancelada no serviço de assinatura.';
    if (r === 'ERRO') return 'Não foi possível consultar o serviço de assinatura agora. Tente de novo.';
    if (r === 'DESCONHECIDA') return 'O serviço de assinatura devolveu um estado desconhecido. Confira antes de repetir.';
    return null; // ASSINADA | JA_ASSINADA
  }
  if (action === 'pagar-cedente') {
    if (j.status === 'PROCESSANDO') return 'Pix em processamento. Reconsultar não paga de novo; confira mais tarde.';
    if (j.status === 'INCERTO') return 'Resultado do Pix incerto. Reconsulte antes de qualquer nova ação; não repita o pagamento.';
    if (j.status === 'FALHOU') return 'O Pix falhou. Use "Reabrir pagamento" depois de conferir.';
    return null; // COMPROVADA ou sem status
  }
  return null;
}
