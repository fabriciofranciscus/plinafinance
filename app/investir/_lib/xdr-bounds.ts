/**
 * Prazo (`maxTime`) de um envelope Stellar, lido do próprio XDR — sem
 * passphrase de rede (o cliente não a conhece). Usado no claim (E2-3) para não
 * pedir assinatura de um XDR que vence no caminho.
 *
 * `0`/ausente = sem limite de tempo.
 */

import { xdr } from '@stellar/stellar-sdk';

export function xdrMaxTime(xdrBase64: string): number {
  let env: xdr.TransactionEnvelope;
  try {
    env = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
  } catch {
    // Não é um envelope legível: a validade fica por conta do servidor/Horizon.
    return 0;
  }
  let cond: xdr.Preconditions;
  switch (env.switch()) {
    case xdr.EnvelopeType.envelopeTypeTx():
      cond = env.v1().tx().cond();
      break;
    case xdr.EnvelopeType.envelopeTypeTxFeeBump():
      return 0;
    default:
      return 0;
  }
  const bounds =
    cond.switch() === xdr.PreconditionType.precondTime()
      ? cond.timeBounds()
      : cond.switch() === xdr.PreconditionType.precondV2()
        ? cond.v2().timeBounds()
        : null;
  if (!bounds) return 0;
  return Number(bounds.maxTime().toString());
}

/** `true` se o XDR já venceu, ou vence em até `margemSec` (padrão 20 s: tempo de assinar). */
export function xdrExpirado(
  xdrBase64: string,
  agoraSec: number = Math.floor(Date.now() / 1000),
  margemSec = 20,
): boolean {
  const max = xdrMaxTime(xdrBase64);
  return max > 0 && agoraSec >= max - margemSec;
}
