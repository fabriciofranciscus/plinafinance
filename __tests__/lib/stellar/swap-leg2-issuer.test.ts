import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  assertSwapXdrMatchesQuote,
  type SwapXdrExpectation,
} from '@/lib/stellar/parse-swap-xdr';
import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';

/**
 * N1 (Consuelo, decisão da Thais — opção a): a subscrição emite token novo.
 * Perna 1: investidor → distributor no ativo-ponte (caixa do fundo).
 * Perna 2: issuer → investidor em PLINARF (emissão; supply +q).
 * O distributor não entrega PLINARF na subscrição. Contrato:
 * contratos/2026-11-10-n1-subscricao-emite.md.
 */
const INVESTOR = Keypair.random().publicKey();
const DISTRIBUTOR = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const OUTRA = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const PLINARF = new Asset('PLINARF', ISSUER);

const BRIDGE = '340.2300000';
const PLINARF_AMOUNT = '376.4705882';

const EXPECT: SwapXdrExpectation = {
  investorPubkey: INVESTOR,
  distributorPubkey: DISTRIBUTOR,
  issuerPubkey: ISSUER,
  bridgeAsset: { code: TESOURO.getCode(), issuer: TESOURO.getIssuer() },
  expectedBridgeAmount: BRIDGE,
  expectedPlinarfAmount: PLINARF_AMOUNT,
};

/** XDR de swap com a origem da perna 2 configurável (`undefined` = herda a tx). */
function xdrComPerna2De(source2: string | undefined): string {
  return new TransactionBuilder(new Account(INVESTOR, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        source: INVESTOR,
        destination: DISTRIBUTOR,
        asset: TESOURO,
        amount: BRIDGE,
      }),
    )
    .addOperation(
      Operation.payment({
        ...(source2 ? { source: source2 } : {}),
        destination: INVESTOR,
        asset: PLINARF,
        amount: PLINARF_AMOUNT,
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

describe('assertSwapXdrMatchesQuote — perna 2 só do issuer (N1)', () => {
  it('aceita perna 2 vinda do issuer', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrComPerna2De(ISSUER), EXPECT)).not.toThrow();
  });

  it('recusa perna 2 vinda do distributor (venda da tesouraria)', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrComPerna2De(DISTRIBUTOR), EXPECT)).toThrow(
      /leg2 source=.* ≠ issuer/,
    );
  });

  it('recusa perna 2 vinda de qualquer outra conta', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrComPerna2De(OUTRA), EXPECT)).toThrow(
      /leg2 source/,
    );
  });

  it('recusa perna 2 sem source explícito (herdaria o investidor)', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrComPerna2De(undefined), EXPECT)).toThrow(
      /leg2 source/,
    );
  });
});

describe('buildSwapBridgeForPlinarfXdr — perna 2 do issuer (N1)', () => {
  beforeEach(() => {
    _resetFeeCacheForTests();
    vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(new Account(INVESTOR, '41') as never);
  });

  async function montar() {
    const { xdr } = await buildSwapBridgeForPlinarfXdr({
      investorPubkey: INVESTOR,
      bridgeAsset: TESOURO,
      bridgeAmount: BRIDGE,
      plinarfAmount: PLINARF_AMOUNT,
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
    });
    return xdr;
  }

  it('perna 1 investidor → distributor no ponte; perna 2 issuer → investidor em PLINARF', async () => {
    const tx = new Transaction(await montar(), networkPassphrase);
    const [op1, op2] = tx.operations as Operation.Payment[];

    expect(tx.source).toBe(INVESTOR);
    expect(tx.operations).toHaveLength(2);
    expect(op1.source).toBe(INVESTOR);
    expect(op1.destination).toBe(DISTRIBUTOR);
    expect(op1.asset.equals(TESOURO)).toBe(true);
    expect(op1.amount).toBe(BRIDGE);
    expect(op2.source).toBe(ISSUER);
    expect(op2.destination).toBe(INVESTOR);
    expect(op2.asset.equals(PLINARF)).toBe(true);
    expect(op2.amount).toBe(PLINARF_AMOUNT);
  });

  it('o XDR do builder passa no validador', async () => {
    const xdr = await montar();
    expect(() => assertSwapXdrMatchesQuote(xdr, EXPECT)).not.toThrow();
  });
});
