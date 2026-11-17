/**
 * Quantidade de tokens do resgate: decimal com até 7 casas (contrato E2-4:
 * /^\d{1,12}(\.\d{1,7})?$/). Só valida e formata o que a pessoa digita; o
 * servidor continua sendo a autoridade.
 */

const FORMATO = /^\d{1,12}(\.\d{1,7})?$/;

/** Parte inteira com milhar bem formado: 1 a 3 dígitos e grupos de 3 ("1.234.567"). */
const milharValido = (inteira: string, sep: '.' | ','): boolean => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(inteira);

/**
 * Aceita os formatos que a pessoa digita e devolve decimal puro com ponto: "1,25" → "1.25"; "1.234,5" e "1,234.5" →
 * "1234.5" (o último separador é o decimal); vários separadores iguais com grupos de 3 ("1.234.567") são milhar. Um só
 * ponto é decimal ("1.234" = 1,234): ambíguo, e a regra antiga fica. Milhar mal formado ("1..2", "12.34.5") não é
 * "consertado": volta como veio e `quantidadeValida` recusa. Só formata; quem valida é `quantidadeValida`.
 */
export function normalizarQuantidade(v: string): string {
  const s = v.trim();
  const virgulas = (s.match(/,/g) ?? []).length;
  const pontos = (s.match(/\./g) ?? []).length;
  if (virgulas > 0 && pontos > 0) {
    const iDec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const decimal = s[iDec] as ',' | '.';
    const milhar = decimal === ',' ? '.' : ',';
    const inteira = s.slice(0, iDec);
    if (!milharValido(inteira, milhar)) return s;
    return inteira.split(milhar).join('') + '.' + s.slice(iDec + 1);
  }
  if (virgulas > 1) return milharValido(s, ',') ? s.split(',').join('') : s;
  if (pontos > 1) return milharValido(s, '.') ? s.split('.').join('') : s;
  return s.replace(',', '.');
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
