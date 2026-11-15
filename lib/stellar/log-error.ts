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

export interface SafeHorizonError {
  name?: string;
  message?: string;
  status?: number;
  title?: string;
  result_codes?: unknown;
}

export function extractSafeError(err: unknown): SafeHorizonError {
  if (!err || typeof err !== 'object') {
    return { name: 'erro' };
  }
  const e = err as {
    name?: string;
    message?: string;
    response?: {
      data?: {
        status?: number;
        title?: string;
        extras?: { result_codes?: unknown };
      };
    };
  };
  // `message` só em erro do Horizon (tem `response.data`): é curta e sem dado pessoal. Em qualquer outro erro (Prisma, anchor, SMTP)
  // a mensagem pode ecoar valores enviados (e-mail, CPF, chave Pix) e NÃO entra: só o nome da classe.
  const horizon = e.response?.data !== undefined;
  return {
    name: typeof e.name === 'string' ? e.name : 'erro',
    ...(horizon ? { message: e.message } : {}),
    status: e.response?.data?.status,
    title: e.response?.data?.title,
    result_codes: e.response?.data?.extras?.result_codes,
  };
}
