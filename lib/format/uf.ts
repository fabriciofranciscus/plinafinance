/** As 27 siglas de UF válidas (26 estados + DF). */
export const UFS_VALIDAS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export function isUfValida(sigla: string): boolean {
  return (UFS_VALIDAS as readonly string[]).includes(sigla.trim().toUpperCase());
}
