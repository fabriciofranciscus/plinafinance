import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  buildSwapBridgeForPlinarfXdr,
  submitWithPrivySignature,
} from '@/lib/stellar/transactions';
import {
  TrustlineNaoAutorizadaError,
  exigirTrustlineAutorizada,
  pernasDeEmissao,
} from '@/lib/stellar/trustline';

/**
 * N1-at: a perna de emissão só sai para trustline já autorizada.
 * Contrato: contratos/2026-11-11-n1-at-trustline-autorizada.md.
 */
const INVESTOR = Keypair.random();
const ISSUER = Keypair.random().publicKey();
const DISTRIBUTOR = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const PLINARF = new Asset('PLINARF', ISSUER);

function linha(code: string, issuer: string, autorizada: boolean | undefined) {
  return { asset_type: 'credit_alphanum12', asset_code: code, asset_issuer: issuer, balance: '0', is_authorized: autorizada };
}

function contaCom(balances: unknown[]) {
  return Object.assign(new Account(INVESTOR.publicKey(), '41'), { balances }) as never;
}

beforeEach(() => {
  _resetFeeCacheForTests();
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'submitTransaction').mockResolvedValue({ hash: 'h', successful: true } as never);
});

function montar() {
  return buildSwapBridgeForPlinarfXdr({
    investorPubkey: INVESTOR.publicKey(),
    bridgeAsset: TESOURO,
    bridgeAmount: '340.2300000',
    plinarfAmount: '376.4705882',
    issuerPubkey: ISSUER,
    distributorPubkey: DISTRIBUTOR,
  });
}

describe('exigirTrustlineAutorizada', () => {
  it('aceita só is_authorized === true', () => {
    expect(() => exigirTrustlineAutorizada([linha('PLINARF', ISSUER, true)], 'PLINARF', ISSUER)).not.toThrow();
    for (const [b, code] of [
      [[], 'TRUSTLINE_AUSENTE'],
      [undefined, 'TRUSTLINE_AUSENTE'],
      [[linha('PLINARF', DISTRIBUTOR, true)], 'TRUSTLINE_AUSENTE'], // outro issuer
      [[linha('PLINARFB', ISSUER, true)], 'TRUSTLINE_AUSENTE'], // outra classe
      [[linha('PLINARF', ISSUER, false)], 'TRUSTLINE_NAO_AUTORIZADA'],
      [[linha('PLINARF', ISSUER, undefined)], 'TRUSTLINE_NAO_AUTORIZADA'],
    ] as const) {
      const err = (() => {
        try {
          exigirTrustlineAutorizada(b as never, 'PLINARF', ISSUER);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(TrustlineNaoAutorizadaError);
      expect((err as TrustlineNaoAutorizadaError).code).toBe(code);
    }
  });

  it('authorized_to_maintain_liabilities não basta para receber', () => {
    const b = [{ ...linha('PLINARF', ISSUER, false), is_authorized_to_maintain_liabilities: true }];
    expect(() => exigirTrustlineAutorizada(b, 'PLINARF', ISSUER)).toThrow(TrustlineNaoAutorizadaError);
  });
});

describe('buildSwapBridgeForPlinarfXdr — N1-at', () => {
  it('trustline PLINARF autorizada: monta', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(contaCom([linha('PLINARF', ISSUER, true)]));
    await expect(montar()).resolves.toHaveProperty('xdr');
  });

  it('trustline não autorizada: recusa no build', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(contaCom([linha('PLINARF', ISSUER, false)]));
    const err = await montar().catch((e: unknown) => e);
    expect((err as TrustlineNaoAutorizadaError).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
  });

  it('sem trustline: recusa no build', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(contaCom([]));
    const err = await montar().catch((e: unknown) => e);
    expect((err as TrustlineNaoAutorizadaError).code).toBe('TRUSTLINE_AUSENTE');
  });
});

describe('submitWithPrivySignature — N1-at, recusa antes de submeter', () => {
  async function xdrValido() {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValueOnce(contaCom([linha('PLINARF', ISSUER, true)]));
    return (await montar()).xdr;
  }
  /** Assinatura real do investidor sobre o hash da tx (addSignature valida). */
  const sig = (xdr: string) =>
    '0x' + INVESTOR.sign(new Transaction(xdr, networkPassphrase).hash()).toString('hex');

  it('trustline revogada entre o build e o submit: não chega à rede', async () => {
    const xdr = await xdrValido();
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(contaCom([linha('PLINARF', ISSUER, false)]));

    const err = await submitWithPrivySignature({
      xdr,
      investorPubkey: INVESTOR.publicKey(),
      investorSignatureHex: sig(xdr),
    }).catch((e: unknown) => e);

    expect((err as TrustlineNaoAutorizadaError).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });

  it('trustline autorizada: segue para a rede', async () => {
    const xdr = await xdrValido();
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(contaCom([linha('PLINARF', ISSUER, true)]));
    await submitWithPrivySignature({ xdr, investorPubkey: INVESTOR.publicKey(), investorSignatureHex: sig(xdr) });
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('falha ao carregar a conta propaga (não submete)', async () => {
    const xdr = await xdrValido();
    vi.spyOn(horizon, 'loadAccount').mockRejectedValue(new Error('horizon 504'));
    await expect(
      submitWithPrivySignature({ xdr, investorPubkey: INVESTOR.publicKey(), investorSignatureHex: sig(xdr) }),
    ).rejects.toThrow('horizon 504');
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });

  it('tx sem emissão (ex.: changeTrust) não consulta trustline', async () => {
    const tx = new TransactionBuilder(new Account(INVESTOR.publicKey(), '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.changeTrust({ asset: PLINARF }))
      .setTimeout(60)
      .build();
    const load = vi.spyOn(horizon, 'loadAccount');
    await submitWithPrivySignature({ xdr: tx.toXDR(), investorPubkey: INVESTOR.publicKey(), investorSignatureHex: sig(tx.toXDR()) });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('pernasDeEmissao', () => {
  it('pega payment do issuer, ignora queima (destino = issuer) e pagamento de terceiro', () => {
    const tx = new TransactionBuilder(new Account(INVESTOR.publicKey(), '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: ISSUER, destination: INVESTOR.publicKey(), asset: PLINARF, amount: '1' }))
      .addOperation(Operation.payment({ source: INVESTOR.publicKey(), destination: ISSUER, asset: PLINARF, amount: '1' }))
      .addOperation(Operation.payment({ source: DISTRIBUTOR, destination: INVESTOR.publicKey(), asset: TESOURO, amount: '1' }))
      .setTimeout(60)
      .build();
    expect(pernasDeEmissao(tx)).toEqual([{ destination: INVESTOR.publicKey(), code: 'PLINARF', issuer: ISSUER }]);
  });
});
