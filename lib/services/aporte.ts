/**
 * Aporte da cota em reais = valorCarta × (1 − deságio), calculado em INTEIROS (BigInt), sem Prisma e sem importar nada: pode entrar
 * no bundle do cliente. É a mesma conta do servidor (`navDaCotaAsDecimal` em pool.ts: Decimal, 2 casas, arredondamento MEIO-PAR),
 * para a Revisão do /admin mostrar o número que será gravado, inclusive nos "meios exatos" (produto terminando em 5 na 3ª casa),
 * onde a conta em ponto flutuante da tela arredondava para cima e diferia em R$ 0,01 (#157, opção (b) da Íris). O teste
 * `__tests__/services/aporte.test.ts` trava a igualdade com o servidor.
 *
 * Limites = os das colunas (carta Decimal(15,2): até 13 inteiros e 2 casas; deságio Decimal(5,4): fração em [0, 1] com até 4
 * casas). Fora deles, texto que não é número simples, deságio fora de [0, 1] ou aporte que não seja positivo: devolve `null`
 * (a tela mostra "—"; o servidor recusaria: DESAGIO_INVALIDO / CUSTO_INVALIDO). Devolve texto com 2 casas ("80000.00"), sem formato.
 */

// O alvo do TypeScript é ES2017: sem literais 10n nem `**` em BigInt (só chamadas BigInt(...) e multiplicação).
const ZERO = BigInt(0);
const UM = BigInt(1);
const DOIS = BigInt(2);
const DEZ = BigInt(10);
const CEM = BigInt(100);

function potenciaDe10(n: number): bigint {
  let r = UM;
  for (let i = 0; i < n; i++) r = r * DEZ;
  return r;
}

const CARTA = /^(\d{1,13})(?:\.(\d{1,2}))?$/;
const DESAGIO = /^(\d)(?:\.(\d{1,4}))?$/;

export function aporteDaCotaBrl(valorCarta: unknown, desagio: unknown): string | null {
  if (typeof valorCarta !== 'string' || typeof desagio !== 'string') return null;
  const c = CARTA.exec(valorCarta);
  const d = DESAGIO.exec(desagio);
  if (!c || !d) return null;

  const fracC = c[2] ?? '';
  const fracD = d[2] ?? '';
  const cartaInteira = BigInt(c[1]! + fracC); // carta × 10^|fracC|
  const desagioInteiro = BigInt(d[1]! + fracD); // deságio × 10^|fracD|
  const umInteiro = potenciaDe10(fracD.length);
  if (desagioInteiro > umInteiro) return null; // deságio > 1

  // aporte em centavos = carta × (1 − deságio) × 100, arredondado meio-par:
  //   num / den, com num = cartaInteira × (10^g − desagioInteiro) × 100 e den = 10^(|fracC| + g)
  const num = cartaInteira * (umInteiro - desagioInteiro) * CEM;
  const den = potenciaDe10(fracC.length + fracD.length);
  let centavos = num / den;
  const resto = num % den;
  const dobro = resto * DOIS;
  if (dobro > den || (dobro === den && centavos % DOIS === UM)) centavos = centavos + UM;

  if (centavos <= ZERO) return null; // aporte zero: o servidor recusa (CUSTO_INVALIDO)
  return `${(centavos / CEM).toString()}.${(centavos % CEM).toString().padStart(2, '0')}`;
}
