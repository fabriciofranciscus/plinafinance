/**
 * Componente de prazo no deságio — curva de yield do pool (PRD §3.4).
 *
 * Provisório — ver docs/2026-06-30-spread-cdi-provisorio.md. Representa o
 * yield-alvo Sênior (CDI + 5% a.a.) embutido linearmente no deságio,
 * proporcional ao prazo restante da carta. Não há feed real de CDI nem
 * spread calibrado ainda — esse número será revisto quando o outreach
 * institucional (Entregável 2) e dados reais de inadimplência existirem.
 *
 * Mesmo padrão de `lib/config/administradoras.ts`: versionado em código,
 * revisão via PR + histórico no git.
 */

export const TAXA_ANUAL_DESCONTO_BPS = 1500; // 15% a.a. ≈ CDI + 5% provisório

/**
 * Componente de deságio (bps) atribuível ao prazo restante da carta,
 * linear sobre a taxa anual: `(taxaAnual / 12) × prazoRestanteMeses`.
 * Sem prazo informado → 0 (compatível com ofertas que não o coletam).
 */
export function taxaPrazoBpsFor(prazoRestanteMeses?: number): number {
  if (!prazoRestanteMeses || prazoRestanteMeses <= 0) return 0;
  return Math.round((TAXA_ANUAL_DESCONTO_BPS / 12) * prazoRestanteMeses);
}
