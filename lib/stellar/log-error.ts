/**
 * Logger redator pra erros de Horizon. Mantém `result_codes` (transaction +
 * operation codes — info útil em debug, curto) e drop deliberado de
 * `result_xdr` / `envelope_xdr` / `result_meta_xdr`, que em logs centralizados
 * expõem source account, ops, e contexto de envelope (audit F-20).
 *
 * Usar no catch ao redor de `horizon.submitTransaction(...)`. Não substitui
 * `console.log` informacional fora do path de erro.
 */
export function logStellarError(prefix: string, err: unknown): void {
  console.error(prefix, extractSafeError(err));
}

interface SafeHorizonError {
  message?: string;
  status?: number;
  title?: string;
  result_codes?: unknown;
}

function extractSafeError(err: unknown): SafeHorizonError {
  if (!err || typeof err !== 'object') {
    return { message: String(err) };
  }
  const e = err as {
    message?: string;
    response?: {
      data?: {
        status?: number;
        title?: string;
        extras?: { result_codes?: unknown };
      };
    };
  };
  return {
    message: e.message,
    status: e.response?.data?.status,
    title: e.response?.data?.title,
    result_codes: e.response?.data?.extras?.result_codes,
  };
}
