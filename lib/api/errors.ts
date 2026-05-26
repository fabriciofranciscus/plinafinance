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
  'STELLAR_SUBMIT_FAILED', // 502 — Horizon retornou erro
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
