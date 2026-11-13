/**
 * Quantidade de tokens do resgate: decimal com até 7 casas (contrato E2-4:
 * /^\d{1,12}(\.\d{1,7})?$/). Só valida e formata o que a pessoa digita; o
 * servidor continua sendo a autoridade.
 */

const FORMATO = /^\d{1,12}(\.\d{1,7})?$/;

/** Aceita vírgula como separador (pt-BR) e devolve o ponto. */
export function normalizarQuantidade(v: string): string {
  return v.trim().replace(',', '.');
}

/** > 0, no formato do contrato e não maior que o saldo exibido. */
export function quantidadeValida(v: string, saldoMax: number): boolean {
  const n = normalizarQuantidade(v);
  if (!FORMATO.test(n)) return false;
  const num = Number(n);
  return num > 0 && num <= saldoMax;
}

/** Saldo como texto para o botão "Máx": trunca em 7 casas (nunca acima do saldo) e tira zeros à direita. */
export function quantidadeMaxima(saldo: number): string {
  if (!Number.isFinite(saldo) || saldo <= 0) return '';
  const trunc = Math.floor(saldo * 1e7 + 1e-6) / 1e7;
  return trunc.toFixed(7).replace(/\.?0+$/, '');
}
