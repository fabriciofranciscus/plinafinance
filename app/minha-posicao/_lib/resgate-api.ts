/**
 * Cliente do resgate (E2-6), contra o contrato do Bento
 * (contratos/2026-11-11-e2-4-resgate-api.md):
 *   POST /api/investidor/liquidar/build  { amountPlinarf }
 *     -> { quoteId, xdr, hashHex, amountPlinarf, brlEquivalente,
 *          navPorTokenNaCotacao, expiresAt }   (valores em string decimal)
 *   POST /api/investidor/liquidar/submit { quoteId, signedXdr } -> { txHash }
 *   Erros { error, code }: 409 NAV_MUDOU (recotar), 410 COTACAO_EXPIRADA,
 *   409 SWAP_EM_CONFERENCIA, 409 CONFLICT (cotação já usada com outro XDR),
 *   409 LIQUIDEZ_INSUFICIENTE (Atlas: caixa do fundo ou TESOURO do distributor
 *   não cobrem o valor), 400 VALIDATION_FAILED, 422 CLASSE_INDISPONIVEL,
 *   503 LEDGER_UNAVAILABLE (só com o código: um 503 sem código é ambíguo → genérico).
 *
 * O cliente só exibe os valores do servidor: nada é calculado aqui. Erros viram
 * tipos (nunca o texto cru da resposta); o código fica para os detalhes técnicos.
 */

import { unwrapEnvelope } from '@/lib/http/client';

/**
 * Liga o texto "A rede recusou o resgate" (tokens NÃO resgatados) para STELLAR_SUBMIT_FAILED.
 * Só pode ser `true` quando o Bento entregar STELLAR_SUBMIT_INCERTO separado e a reserva
 * liberada na hora (Atlas aprovou; falta o código no backend).
 */
export const SEPARACAO_502_ENTREGUE = false;

export interface ResgateBuild {
  quoteId: string;
  xdr: string;
  hashHex: string;
  amountPlinarf: string;
  brlEquivalente: string;
  navPorTokenNaCotacao: string;
  expiresAt: string;
}

export type ResgateErroTipo =
  | 'nav_mudou'
  | 'cotacao_expirada'
  | 'conflito'
  | 'sem_liquidez'
  | 'em_conferencia'
  | 'indisponivel'
  | 'classe_indisponivel'
  | 'rede_nao_confirmou'
  | 'rede_recusou'
  | 'preco_fora_da_faixa'
  | 'acima_do_teto'
  | 'generico';

export class ResgateError extends Error {
  constructor(
    readonly tipo: ResgateErroTipo,
    readonly codigo: string | null = null,
  ) {
    super(tipo);
    this.name = 'ResgateError';
  }
}

async function post<T>(
  url: string,
  body: unknown,
  getAccessToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new ResgateError('generico', 'SESSAO_EXPIRADA');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ResgateError('generico', 'REDE');
  }
  if (!res.ok) {
    const j = (await res
      .clone()
      .json()
      .catch(() => null)) as { code?: string; error?: { code?: string } | string | null } | null;
    const codigo = j?.code ?? (j && typeof j.error === 'object' ? j.error?.code : undefined) ?? null;
    if (res.status === 410 || codigo === 'COTACAO_EXPIRADA') throw new ResgateError('cotacao_expirada', codigo);
    if (codigo === 'NAV_MUDOU') throw new ResgateError('nav_mudou', codigo);
    if (codigo === 'SWAP_EM_CONFERENCIA') throw new ResgateError('em_conferencia', codigo);
    if (codigo === 'CONFLICT') throw new ResgateError('conflito', codigo);
    if (codigo === 'LIQUIDEZ_INSUFICIENTE') throw new ResgateError('sem_liquidez', codigo);
    if (codigo === 'PRECO_FORA_DA_FAIXA') throw new ResgateError('preco_fora_da_faixa', codigo);
    if (codigo === 'RESGATE_ACIMA_DO_TETO') throw new ResgateError('acima_do_teto', codigo);
    if (codigo === 'CLASSE_INDISPONIVEL') throw new ResgateError('classe_indisponivel', codigo);
    if (codigo === 'LEDGER_UNAVAILABLE') throw new ResgateError('indisponivel', codigo);
    // 502 cobre rejeição real E resposta ambígua (a tx pode ter entrado): nunca "não resgatado"
    // STELLAR_SUBMIT_INCERTO (timeout/5xx/rede) é sempre ambíguo. STELLAR_SUBMIT_FAILED só vira
    // "recusou" quando o Bento entregar a separação (SEPARACAO_502_ENTREGUE); até lá o 502
    // ainda cobre os dois casos e o texto é o de "não confirmou" (Norma §2.9).
    if (codigo === 'STELLAR_SUBMIT_INCERTO') throw new ResgateError('rede_nao_confirmou', codigo);
    if (codigo === 'STELLAR_SUBMIT_FAILED' && SEPARACAO_502_ENTREGUE) throw new ResgateError('rede_recusou', codigo);
    if (codigo === 'STELLAR_SUBMIT_FAILED' || res.status === 502)
      throw new ResgateError('rede_nao_confirmou', codigo ?? 'STELLAR_SUBMIT_FAILED');
    throw new ResgateError('generico', codigo ?? `HTTP_${res.status}`);
  }
  try {
    return await unwrapEnvelope<T>(res);
  } catch {
    throw new ResgateError('generico', 'RESPOSTA_INVALIDA');
  }
}

export function buildResgate(
  amountPlinarf: string,
  getAccessToken: () => Promise<string | null>,
): Promise<ResgateBuild> {
  return post<ResgateBuild>('/api/investidor/liquidar/build', { amountPlinarf }, getAccessToken);
}

export function submitResgate(
  body: { quoteId: string; signedXdr: string },
  getAccessToken: () => Promise<string | null>,
): Promise<{ txHash: string }> {
  return post<{ txHash: string }>('/api/investidor/liquidar/submit', body, getAccessToken);
}
