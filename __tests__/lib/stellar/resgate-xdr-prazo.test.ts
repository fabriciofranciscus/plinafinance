import { describe, it, expect } from 'vitest';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { assertResgateXdrMatchesQuote, type ResgateXdrExpectation } from '@/lib/stellar/resgate';

/**
 * E2-6 / N1-S1 no resgate (pedido do Bento): quem co-assina é o distributor,
 * que paga TESOURO. O envelope montado pelo investidor tem de ter janela curta
 * e já aberta, e não pode valer além do prazo da cotação + 120 s.
 */
const INVESTOR = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const DISTRIBUTOR = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const AGORA = 1_800_000_000;

const EXPECT: ResgateXdrExpectation = {
  investorPubkey: INVESTOR,
  issuerPubkey: ISSUER,
  distributorPubkey: DISTRIBUTOR,
  bridgeAsset: { code: 'TESOURO', issuer: TESOURO.getIssuer() },
  plinarfCode: 'PLINARF',
  expectedPlinarfAmount: '376.4705882',
  expectedBridgeAmount: '340.2300000',
  quoteExpiresAt: new Date((AGORA + 300) * 1000),
};

function xdr(janela: { minTime?: number; maxTime?: number }): string {
  return new TransactionBuilder(new Account(INVESTOR, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: janela.minTime ?? 0, maxTime: janela.maxTime ?? 0 },
  })
    .addOperation(Operation.payment({ source: INVESTOR, destination: ISSUER, asset: new Asset('PLINARF', ISSUER), amount: '376.4705882' }))
    .addOperation(Operation.payment({ source: DISTRIBUTOR, destination: INVESTOR, asset: TESOURO, amount: '340.2300000' }))
    .build()
    .toXDR();
}

const valida = (x: string, e: Partial<ResgateXdrExpectation> = {}) => () =>
  assertResgateXdrMatchesQuote(x, { ...EXPECT, ...e }, { agoraSec: AGORA });

describe('assertResgateXdrMatchesQuote — janela de validade', () => {
  it('aceita a janela do build (maxTime = agora + 120) e até agora + 180', () => {
    expect(valida(xdr({ maxTime: AGORA + 120 }))).not.toThrow();
    expect(valida(xdr({ maxTime: AGORA + 180 }))).not.toThrow();
  });

  it('recusa maxTime 0 e maxTime > agora + 180', () => {
    expect(valida(xdr({ maxTime: 0 }))).toThrow(/maxTime/);
    expect(valida(xdr({ maxTime: AGORA + 181 }))).toThrow(/maxTime/);
  });

  it('recusa minTime > agora + 5', () => {
    expect(valida(xdr({ minTime: AGORA + 5, maxTime: AGORA + 120 }))).not.toThrow();
    expect(valida(xdr({ minTime: AGORA + 6, maxTime: AGORA + 120 }))).toThrow(/minTime/);
  });
});

describe('assertResgateXdrMatchesQuote — prazo da cotação (N1-S1)', () => {
  it('maxTime ≤ quoteExpiresAt + 120 passa; além disso recusa', () => {
    const expira = new Date((AGORA + 30) * 1000);
    expect(valida(xdr({ maxTime: AGORA + 150 }), { quoteExpiresAt: expira })).not.toThrow();
    expect(valida(xdr({ maxTime: AGORA + 151 }), { quoteExpiresAt: expira })).toThrow(/quote/);
  });

  it('cotação vencida ontem: re-assinar tarde a NAV velho é recusado', () => {
    expect(valida(xdr({ maxTime: AGORA + 120 }), { quoteExpiresAt: new Date((AGORA - 86_400) * 1000) })).toThrow(/quote/);
  });

  it('quoteExpiresAt ausente ou inválido → recusa (fail-closed)', () => {
    const { quoteExpiresAt: _q, ...semPrazo } = EXPECT;
    expect(() => assertResgateXdrMatchesQuote(xdr({ maxTime: AGORA + 120 }), semPrazo as ResgateXdrExpectation, { agoraSec: AGORA })).toThrow(/quoteExpiresAt/);
    expect(valida(xdr({ maxTime: AGORA + 120 }), { quoteExpiresAt: new Date('x') })).toThrow(/quoteExpiresAt/);
  });

  it('sem agoraSec usa o relógio do servidor', () => {
    const agoraReal = Math.floor(Date.now() / 1000);
    const e = { ...EXPECT, quoteExpiresAt: new Date((agoraReal + 300) * 1000) };
    expect(() => assertResgateXdrMatchesQuote(xdr({ maxTime: agoraReal + 120 }), e)).not.toThrow();
    expect(() => assertResgateXdrMatchesQuote(xdr({ maxTime: agoraReal + 3_600 }), e)).toThrow(/maxTime/);
  });
});
