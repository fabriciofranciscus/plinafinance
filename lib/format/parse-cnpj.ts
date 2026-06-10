/**
 * Validador de CNPJ (módulo 11). Aceita formato com ou sem máscara.
 * Retorna o CNPJ normalizado (14 dígitos) ou `null` se inválido.
 *
 * Rejeita:
 *   - tamanho ≠ 14 dígitos
 *   - todos os dígitos iguais (00.000.000/0000-00, 11..., etc — inválidos por construção)
 *   - dígitos verificadores incorretos
 *
 * Espelha `parse-cpf.ts` (mesma estratégia de DV mod-11), mas com os pesos
 * cíclicos 2..9 da Receita Federal pro CNPJ.
 */
export function parseCnpj(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 14) return null;
  if (/^(\d)\1{13}$/.test(digits)) return null;

  // Pesos da Receita: começam em 5 (1º DV, 12 dígitos) e 6 (2º DV, 13 dígitos),
  // decrescendo até 2 e ciclando 9→2.
  const calcDV = (len: number): number => {
    let weight = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += parseInt(digits[i]!, 10) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const dv1 = calcDV(12);
  const dv2 = calcDV(13);

  if (dv1 !== parseInt(digits[12]!, 10)) return null;
  if (dv2 !== parseInt(digits[13]!, 10)) return null;

  return digits;
}
