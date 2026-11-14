/**
 * Erros de domínio da camada de API.
 *
 * Handlers usam `throw new ApiError('CODE', 401, 'mensagem')` e o wrapper
 * `withApi` converte em envelope `{ data: null, error: { code, message,
 * requestId } }`. Cliente discrimina por `code` (machine-readable), não
 * por `message` (texto livre).
 *
 * AuthError do `lib/wallet/auth-guard` continua existindo pra compat com
 * handlers que ainda usam `withAuth`. O `withApi` também captura AuthError
 * e mapeia 401/403 → UNAUTHORIZED/FORBIDDEN.
 */

export const API_ERROR_CODES = [
  'UNAUTHORIZED',          // 401 — token ausente ou inválido
  'FORBIDDEN',             // 403 — autenticado mas sem permissão
  'NOT_ONBOARDED',         // 403 — token Privy OK mas sem Investidor no DB
  'VALIDATION_FAILED',     // 400 — Zod rejeitou body/query
  'NOT_FOUND',             // 404 — recurso inexistente
  'CONFLICT',              // 409 — estado inválido (cota já realizada, etc.)
  'GONE',                  // 410 — recurso expirado (quote vencido)
  'LIQUIDEZ_INSUFICIENTE', // 409 — resgate acima do caixa disponível do fundo ou do saldo de TESOURO do distributor
  'PRECO_FORA_DA_FAIXA',   // 409 — preço do TESOURO (Etherfuse) fora de ±2% da referência independente, ou sem referência
  'RESGATE_ACIMA_DO_TETO', // 409 — resgate acima do teto configurável por resgate
  'COTACAO_EXPIRADA',      // 410 — cotação do resgate vencida (ou envelope fora do maxTime)
  'NAV_MUDOU',             // 409 — NAV divergiu da cotação além de 1 bp; recotar
  'SWAP_EM_CONFERENCIA',   // 409 — o investidor tem um swap em conferência (reserva órfã): sem quote/reserva novos
  'CLASSE_INDISPONIVEL',   // 422 — classe (Subordinada) sem NAV próprio: recusada por enquanto
  'TRUSTLINE_AUSENTE',     // 409 — a carteira não tem trustline do token a emitir (N1-at)
  'TRUSTLINE_NAO_AUTORIZADA', // 409 — a trustline não está autorizada pelo emissor (N1-at)
  'RATE_LIMITED',          // 429 — rate-limit estourado
  'STELLAR_SUBMIT_FAILED', // 502 — Horizon retornou erro (a rede RECUSOU: result_codes definitivos)
  'STELLAR_SUBMIT_INCERTO', // 504 — resultado do envio incerto (timeout/5xx/rede): a tx pode ter entrado; segue as regras de órfã
  'LEDGER_UNAVAILABLE',    // 503 — leitura do ledger falhou; NAV indisponível
  'ETHERFUSE_ERROR',       // 502 — anchor retornou erro
  'INTERNAL',              // 500 — erro inesperado (não vaza mensagem original)
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
