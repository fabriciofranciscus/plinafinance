/**
 * Parse de valor monetário do formulário /investir. Aceita formatos:
 *   '1234.56', '1234,56'        — sem milhares
 *   '1.234,56', '1,234.56'      — com milhares
 * Rejeita notação científica ('1e10'), strings vazias, valores
 * não-finitos, zero, negativos (audit F-18).
 *
 * Retorna number positivo finito ou null. Defesa em profundidade:
 * usar tanto no client quanto na rota /api/investidor/quote.
 */
export function parseBrlAmount(input: string | null | undefined): number | null {
  const s = String(input ?? '').trim();
  if (!s || /[eE]/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decSep: ',' | '.' | null =
    lastComma === -1 && lastDot === -1
      ? null
      : lastComma > lastDot
        ? ','
        : '.';
  const normalized =
    decSep === ','
      ? s.replace(/\./g, '').replace(',', '.')
      : decSep === '.'
        ? s.replace(/,/g, '')
        : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}
