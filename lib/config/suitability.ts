import type { TipoInvestidor } from '@prisma/client';

/**
 * F-M3-5 / F-M3-6 — Suitability CVM 30 + ticket mínimo por tipo.
 *
 * Schema do questionário persistido em `Investidor.suitabilityJson`. Versionado
 * pra suportar revisão (CVM 30 atualiza periodicamente). Resposta determina
 * `tipo` (INST_BR_QUALIFICADO vs PROFISSIONAL) e habilita `ticketMinimoCheck`
 * quando todas as respostas estão dentro do esperado.
 *
 * Fonte versionada em TS (boa prática alinhada com `lib/config/administradoras.ts`):
 * poucos perfis, mudanças raras, PR review + git history. Migrar pra tabela DB
 * quando ops precisar editar em runtime.
 */

export type PerfilSuitability = 'CONSERVADOR' | 'MODERADO' | 'ARROJADO';
export type ExperienciaSuitability = 'INICIANTE' | 'INTERMEDIARIA' | 'AVANCADA';

export interface SuitabilityCVM30Answers {
  perfil: PerfilSuitability;
  experiencia: ExperienciaSuitability;
  /** AUM declarado em BRL (string decimal). */
  aumBrl: string;
  /** Declaração de ciência do risco — obrigatório. */
  cienteRisco: boolean;
}

export interface SuitabilityCVM30Persisted extends SuitabilityCVM30Answers {
  versao: 'CVM30-v1';
  preenchidoEm: string;
}

/** PRD §4.1 — tabela de ticket mínimo por tipo institucional (em BRL). */
export const TICKET_MINIMO_BRL: Record<TipoInvestidor, number> = {
  INST_BR_QUALIFICADO: 500_000,
  INST_BR_PROFISSIONAL: 1_000_000,
  // Intl é gated por M4; valor declarativo aqui pra completude.
  INST_INTERNACIONAL_PROFISSIONAL: 500_000,
};

export function ticketMinimoFor(tipo: TipoInvestidor | null | undefined): number {
  return tipo ? TICKET_MINIMO_BRL[tipo] : 0;
}

/**
 * Deriva o tipo institucional do questionário. Perfil + AUM determinam:
 * AUM ≥ R$ 10M + experiência avançada + arrojado → PROFISSIONAL; senão
 * QUALIFICADO (default conservador — exige R$ 500k mas não R$ 1M).
 */
export function tipoFromAnswers(a: SuitabilityCVM30Answers): TipoInvestidor {
  const aum = Number.parseFloat(a.aumBrl);
  const elegivelProfissional =
    Number.isFinite(aum) &&
    aum >= 10_000_000 &&
    a.experiencia === 'AVANCADA' &&
    a.perfil === 'ARROJADO';
  return elegivelProfissional ? 'INST_BR_PROFISSIONAL' : 'INST_BR_QUALIFICADO';
}
