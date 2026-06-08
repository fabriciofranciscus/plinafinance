/**
 * Consumidores das feature flags do PRD §M0 (F-M0-6).
 *
 * As flags vivem em `lib/env/flags.ts` (Edge Config em prod, env em dev). Aqui
 * ficam os pontos de consumo de fato — guards e branches que cada flag gateia.
 */

import { NextResponse } from 'next/server';
import { STELLAR_NETWORK } from '../stellar/config';
import { getFlag } from './flags';

/**
 * Guard de cutover (MAINNET_ENABLED). Em mainnet, bloqueia rotas sensíveis
 * enquanto a flag de cutover estiver off — kill-switch do M9. Retorna uma
 * Response 503 pronta pra devolver, ou `null` quando liberado (testnet sempre
 * liberado; o POC roda em testnet).
 */
export async function mainnetCutoverGuard(): Promise<NextResponse | null> {
  if (STELLAR_NETWORK !== 'PUBLIC') return null;
  if (await getFlag('MAINNET_ENABLED')) return null;
  return NextResponse.json(
    { error: 'mainnet ainda não habilitada (cutover pendente)' },
    { status: 503 },
  );
}

/** SOROBAN_WATERFALL (M7): fonte do NAV/waterfall. Inerte até o contrato existir. */
export function isSorobanWaterfallEnabled(): Promise<boolean> {
  return getFlag('SOROBAN_WATERFALL');
}

/** INTL_INVESTOR_FLOW (M4): habilita onboarding de jurisdição não-BR. */
export function isIntlInvestorFlowEnabled(): Promise<boolean> {
  return getFlag('INTL_INVESTOR_FLOW');
}

/**
 * M3_INSTITUTIONAL_GATING (M3 F-M3-5/6): exige Suitability CVM 30 completada e
 * ticket ≥ mínimo regulatório em `/api/investidor/quote`. Inerte (off) por
 * default — testnet/POC permanece com fluxo single-asset sem gating até o
 * cutover institucional formal.
 */
export function isInstitutionalGatingEnabled(): Promise<boolean> {
  return getFlag('M3_INSTITUTIONAL_GATING');
}
