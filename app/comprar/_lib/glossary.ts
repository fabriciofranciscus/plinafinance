import type { Screen } from '../_types';

export const SCREENS: { id: Screen; label: string }[] = [
  { id: 'buscar', label: 'Buscar cota' },
  { id: 'diligencia', label: 'Due diligence' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'kyc', label: 'KYC' },
  { id: 'cessao', label: 'Assinatura' },
  { id: 'confirmacao', label: 'Transferência' },
];

/**
 * Fases do wizard /comprar = os 5 passos oficiais do mockup. `kyc` e `cessao`
 * são sub-telas da fase "Cessão digital" (o Rail renderiza sub-telas quando a
 * fase tem >1 screen). Agrupar mantém o stepper com exatamente 5 passos.
 */
export interface ComprarPhase {
  id: string;
  label: string;
  screens: Screen[];
}

export const PHASES: ComprarPhase[] = [
  { id: 'buscar', label: 'Buscar cota', screens: ['buscar'] },
  { id: 'diligencia', label: 'Due diligence', screens: ['diligencia'] },
  { id: 'proposta', label: 'Proposta & negociação', screens: ['proposta'] },
  { id: 'cessao', label: 'Cessão digital', screens: ['kyc', 'cessao'] },
  { id: 'confirmacao', label: 'Transferência confirmada', screens: ['confirmacao'] },
];

/** Fase (e seu índice 0-based) que contém a tela atual. */
export function phaseForScreen(screen: Screen): { phase: ComprarPhase; index: number } {
  const index = PHASES.findIndex((p) => p.screens.includes(screen));
  const safe = index === -1 ? 0 : index;
  return { phase: PHASES[safe], index: safe };
}

export const TIPO_LABEL: Record<string, string> = {
  IMOVEL: 'Imóvel',
  VEICULO: 'Veículo',
  EQUIPAMENTO: 'Equipamento',
  SERVICO: 'Serviços',
};

export const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/** Valor de revenda = valor de face × (1 − deságio). */
export function valorRevenda(valorCarta: number, desagioRevenda: number | null): number {
  return Math.floor(valorCarta * (1 - (desagioRevenda ?? 0)));
}
