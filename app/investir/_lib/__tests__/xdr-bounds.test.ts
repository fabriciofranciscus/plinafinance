import { describe, expect, it } from 'vitest';
import { Account, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { xdrExpirado, xdrMaxTime } from '../xdr-bounds';

const kp = Keypair.random();

function xdrWith(timebounds: { minTime: number; maxTime: number } | null): string {
  const b = new TransactionBuilder(new Account(kp.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    ...(timebounds ? { timebounds: { minTime: timebounds.minTime, maxTime: timebounds.maxTime } } : {}),
  }).addOperation(Operation.bumpSequence({ bumpTo: '10' }));
  if (!timebounds) b.setTimeout(0);
  return b.build().toXDR();
}

describe('xdrMaxTime / xdrExpirado', () => {
  it('lê o maxTime do envelope, sem passphrase', () => {
    expect(xdrMaxTime(xdrWith({ minTime: 0, maxTime: 1_800_000_000 }))).toBe(1_800_000_000);
  });

  it('sem limite de tempo nunca expira', () => {
    const x = xdrWith(null);
    expect(xdrMaxTime(x)).toBe(0);
    expect(xdrExpirado(x, 9_999_999_999)).toBe(false);
  });

  it('expira dentro da margem e depois dela; antes, não', () => {
    const x = xdrWith({ minTime: 0, maxTime: 1_000 });
    expect(xdrExpirado(x, 900)).toBe(false);
    expect(xdrExpirado(x, 981, 20)).toBe(true); // faltam 19 s < margem de 20 s
    expect(xdrExpirado(x, 1_001)).toBe(true);
  });

  it('XDR ilegível não é tratado como expirado (a validade fica com o servidor)', () => {
    expect(xdrMaxTime('xdr-1')).toBe(0);
    expect(xdrExpirado('xdr-1')).toBe(false);
  });
});
