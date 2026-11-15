/**
 * Log do cliente Etherfuse SEM dado pessoal (Argus, MEDIUM): só método, rota genérica, status e um id de correlação.
 * Nunca o corpo da requisição (e-mail, CPF, chave Pix, presignedUrl) nem o da resposta (conta, nome, saldo), nem o texto de erro
 * do upstream (pode ecoar o dado enviado). Ids na rota (customer, order, quote) viram `:id`; a query string some.
 */
import { randomUUID } from 'node:crypto';

/** `/ramp/customer/3f2a…/bank-accounts?x=1` → `/ramp/customer/:id/bank-accounts`. */
export function rotaGenerica(endpoint: string): string {
  const semQuery = endpoint.split(/[?#]/)[0] ?? '';
  return semQuery
    .split('/')
    // Segmento com dígito e 8+ caracteres (uuid, order id, quote id) ou comprido demais para ser nome de rota → `:id`.
    .map((seg) => ((seg.length >= 8 && /\d/.test(seg)) || seg.length >= 28 ? ':id' : seg))
    .join('/');
}

/** Id curto só para ligar a linha da requisição à da resposta/erro. Não identifica ninguém. */
export function idDeCorrelacao(): string {
  return randomUUID().slice(0, 8);
}

export function logAnchor(
  nivel: 'log' | 'error',
  e: { id: string; metodo: string; endpoint: string; status?: number; codigo?: string },
): void {
  const partes = [`[Etherfuse] ${e.metodo} ${rotaGenerica(e.endpoint)}`, `id=${e.id}`];
  if (e.status !== undefined) partes.push(`status=${e.status}`);
  // `codigo` = código de erro do upstream (máquina, ex.: INVALID_USER_INFO); a MENSAGEM do upstream nunca é logada.
  if (e.codigo) partes.push(`codigo=${e.codigo}`);
  console[nivel](partes.join(' '));
}
