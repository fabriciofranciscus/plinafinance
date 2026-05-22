/**
 * Validador de CPF (módulo 11). Aceita formato com ou sem máscara.
 * Retorna o CPF normalizado (11 dígitos) ou `null` se inválido.
 *
 * Rejeita:
 *   - tamanho ≠ 11 dígitos
 *   - todos os dígitos iguais (000.000.000-00, 111..., etc — inválidos por construção)
 *   - dígitos verificadores incorretos
 */
export function parseCpf(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;

  const calcDV = (slice: string, weightStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += parseInt(slice[i]!, 10) * (weightStart - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const dv1 = calcDV(digits.slice(0, 9), 10);
  const dv2 = calcDV(digits.slice(0, 10), 11);

  if (dv1 !== parseInt(digits[9]!, 10)) return null;
  if (dv2 !== parseInt(digits[10]!, 10)) return null;

  return digits;
}
