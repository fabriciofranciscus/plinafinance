/**
 * Prazo restante da cota. 0 é um valor VÁLIDO (cota quitada, sem componente de prazo): só `null` é "sem informação".
 * Nunca usar `prazo && <JSX/>` (com 0 o React imprime o próprio "0", achado A-21).
 */
export function fmtPrazo(meses: number | null | undefined, forma: 'curta' | 'longa' = 'curta'): string {
  if (meses === null || meses === undefined) return '—';
  return forma === 'curta' ? `${meses}m` : `${meses} meses`;
}
