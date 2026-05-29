import { ClassePLINARF } from '@prisma/client';
import { assetCode } from './config';

/**
 * Mapeamento classe → asset code on-chain (PRD §M3 / readiness 2026-05-27).
 *
 * Decisão registrada: **PLINARF legacy = Sênior**. O asset existente `PLINARF`
 * continua sendo a classe Sênior (zero churn no código/seed/holders já
 * emitidos); a Subordinada ganha o code novo `PLINARFB`. No cutover mainnet
 * (M9) os assets são reemitidos como `PLINARFS`/`PLINARFB` num issuer limpo —
 * sem holders a migrar, então a renomeação fica contida na config de mainnet.
 *
 * `assetCode` vem de `config.ts` (env `ASSET_CODE`, default `PLINARF`).
 */
export const SUBORDINADA_ASSET_CODE =
  process.env.ASSET_CODE_SUBORDINADA ?? 'PLINARFB';

export function assetCodeForClasse(classe: ClassePLINARF | null | undefined): string {
  return classe === 'SUBORDINADA' ? SUBORDINADA_ASSET_CODE : assetCode;
}

/** Default quando o quote não traz classe (legados/off-ramp): Sênior. */
export function classeOrDefault(
  classe: ClassePLINARF | null | undefined,
): ClassePLINARF {
  return classe === 'SUBORDINADA' ? 'SUBORDINADA' : 'SENIOR';
}
