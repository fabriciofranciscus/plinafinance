import { describe, it, expect } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  assertSwapXdrMatchesQuote,
  type SwapXdrExpectation,
} from '@/lib/stellar/parse-swap-xdr';

/**
 * M1-3 (emissão ao NAV): as duas pernas do swap têm amounts diferentes.
 * Perna 1 = TESOURO pago (quote.toAmount); perna 2 = PLINARF emitido
 * (quote.plinarfAmount = BRL ÷ NAV). Contrato:
 * contratos/2026-11-09-m1-3-emissao-ao-nav.md.
 */
const INVESTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11)).publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13)).publicKey();
const TESOURO_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 14)).publicKey();

const TESOURO = new Asset('TESOURO', TESOURO_ISSUER);
const PLINARF = new Asset('PLINARF', ISSUER);

// Aceite do contrato: NAV 1,0625 → R$ 400 = 376,4705882 PLINARF.
// TESOURO pago é ilustrativo (R$ 400 → 340,23 no sandbox de referência).
const BRIDGE = '340.2300000';
const PLINARF_AMOUNT = '376.4705882';

function xdr(amount1: string, amount2: string): string {
  return new TransactionBuilder(new Account(INVESTOR, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        source: INVESTOR,
        destination: DISTRIBUTOR,
        asset: TESOURO,
        amount: amount1,
      }),
    )
    .addOperation(
      Operation.payment({
        source: DISTRIBUTOR,
        destination: INVESTOR,
        asset: PLINARF,
        amount: amount2,
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

const EXPECT: SwapXdrExpectation = {
  investorPubkey: INVESTOR,
  distributorPubkey: DISTRIBUTOR,
  issuerPubkey: ISSUER,
  bridgeAsset: { code: 'TESOURO', issuer: TESOURO_ISSUER },
  expectedBridgeAmount: BRIDGE,
  expectedPlinarfAmount: PLINARF_AMOUNT,
};

describe('assertSwapXdrMatchesQuote — duas pernas com amounts distintos (M1-3)', () => {
  it('aceita a perna-ponte em TESOURO e a perna PLINARF ao NAV', () => {
    expect(() => assertSwapXdrMatchesQuote(xdr(BRIDGE, PLINARF_AMOUNT), EXPECT)).not.toThrow();
  });

  it('recusa perna PLINARF 1:1 com o TESOURO (o bug do build antigo)', () => {
    expect(() => assertSwapXdrMatchesQuote(xdr(BRIDGE, BRIDGE), EXPECT)).toThrow(
      /leg2 amount/,
    );
  });

  it('recusa perna PLINARF divergente em 1 stroop', () => {
    expect(() =>
      assertSwapXdrMatchesQuote(xdr(BRIDGE, '376.4705883'), EXPECT),
    ).toThrow(/leg2 amount/);
  });

  it('recusa perna-ponte divergente', () => {
    expect(() =>
      assertSwapXdrMatchesQuote(xdr('340.2299999', PLINARF_AMOUNT), EXPECT),
    ).toThrow(/leg1 amount/);
  });

  it('recusa amounts trocados entre as pernas', () => {
    expect(() =>
      assertSwapXdrMatchesQuote(xdr(PLINARF_AMOUNT, BRIDGE), EXPECT),
    ).toThrow(/leg1 amount/);
  });

  it('recusa expectativa sem 7 casas ou não positiva antes de olhar o XDR', () => {
    const ok = xdr(BRIDGE, PLINARF_AMOUNT);
    for (const bad of ['376.47', '0.0000000', '-1.0000000', '1e2', '']) {
      expect(() =>
        assertSwapXdrMatchesQuote(ok, { ...EXPECT, expectedPlinarfAmount: bad }),
      ).toThrow(/expectativa/);
      expect(() =>
        assertSwapXdrMatchesQuote(ok, { ...EXPECT, expectedBridgeAmount: bad }),
      ).toThrow(/expectativa/);
    }
  });

  it('chamador JS com o campo legado expectedAmount é recusado (fail-closed)', () => {
    const { expectedBridgeAmount: _b, expectedPlinarfAmount: _p, ...base } = EXPECT;
    const legado = { ...base, expectedAmount: BRIDGE } as unknown as SwapXdrExpectation;
    expect(() => assertSwapXdrMatchesQuote(xdr(BRIDGE, BRIDGE), legado)).toThrow(
      /expectativa/,
    );
  });
});
