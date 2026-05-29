/**
 * Config por administradora — taxa de anuência (PRD §M1 F-M1-4 / §3.4).
 *
 * A taxa de anuência (em bps) é embutida no deságio quando a cessão segue pelo
 * caminho fallback (`CARTORIO_DIGITAL`) — tipicamente 100–300 bps. Quando houver
 * integração via API da administradora (M1.A, Trilha A), a taxa cai a 0.
 *
 * Boa prática: começar versionado em código — são poucos players, os valores
 * mudam raramente, e ganham revisão via PR + histórico no git (mesmo padrão de
 * `lib/stellar/config.ts` e `lib/rate-limit/config.ts`). Migrar para tabela no
 * DB (seed editável em runtime) só quando a operação precisar ajustar sem deploy.
 */

export const DEFAULT_TAXA_ANUENCIA_BPS = 200;

/** Match por marca normalizada (sem acento, lowercase) — robusto a sufixos
 * tipo "Consórcios"/"Demo". Todos em 100–300 bps. */
const BPS_POR_MARCA: ReadonlyArray<{ marca: string; bps: number }> = [
  { marca: 'embracon', bps: 150 },
  { marca: 'porto', bps: 200 },
  { marca: 'bradesco', bps: 180 },
  { marca: 'caixa', bps: 220 },
  { marca: 'itau', bps: 180 },
];

function normaliza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Taxa de anuência (bps) da administradora no caminho fallback. Desconhecida →
 * `DEFAULT_TAXA_ANUENCIA_BPS`.
 */
export function taxaAnuenciaBpsFor(administradora: string): number {
  const n = normaliza(administradora);
  const found = BPS_POR_MARCA.find((m) => n.includes(m.marca));
  return found?.bps ?? DEFAULT_TAXA_ANUENCIA_BPS;
}
