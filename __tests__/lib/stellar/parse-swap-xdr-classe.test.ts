import { describe, it, expect } from 'vitest';
import {
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

/**
 * F-M3-3 — o validador de swap XDR aceita o asset code da classe escolhida
 * (PLINARF Sênior ou PLINARFB Subordinada) via `plinarfCode`. Sem esse
 * parâmetro, hardcodava PLINARF e rejeitaria emissão de Subordinada.
 */

const INV = Keypair.random();
const DIST = Keypair.random();
const ISSUER = Keypair.random();
const BRIDGE_ISSUER = Keypair.random();

function buildSwapXdr(plinarfCode: string, amount = '100.0000000'): string {
  // Source account dummy — só precisamos do XDR válido pro parser.
  const sourceAccount = {
    accountId: () => INV.publicKey(),
    sequenceNumber: () => '1',
    incrementSequenceNumber: () => {},
  } as unknown as Parameters<typeof TransactionBuilder>[0];

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        source: INV.publicKey(),
        destination: DIST.publicKey(),
        asset: new Asset('TESOURO', BRIDGE_ISSUER.publicKey()),
        amount,
      }),
    )
    .addOperation(
      Operation.payment({
        source: DIST.publicKey(),
        destination: INV.publicKey(),
        asset: new Asset(plinarfCode, ISSUER.publicKey()),
        amount,
      }),
    )
    .addMemo(Memo.text('q:x'))
    .setTimeout(60)
    .build();
  return tx.toXDR();
}

describe('assertSwapXdrMatchesQuote · F-M3-3', () => {
  it('aceita PLINARFB quando plinarfCode=PLINARFB', () => {
    const xdr = buildSwapXdr('PLINARFB');
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey: INV.publicKey(),
        distributorPubkey: DIST.publicKey(),
        issuerPubkey: ISSUER.publicKey(),
        bridgeAsset: { code: 'TESOURO', issuer: BRIDGE_ISSUER.publicKey() },
        expectedAmount: '100.0000000',
        plinarfCode: 'PLINARFB',
      }),
    ).not.toThrow();
  });

  it('rejeita PLINARFB quando plinarfCode=PLINARF (Sênior esperada)', () => {
    const xdr = buildSwapXdr('PLINARFB');
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey: INV.publicKey(),
        distributorPubkey: DIST.publicKey(),
        issuerPubkey: ISSUER.publicKey(),
        bridgeAsset: { code: 'TESOURO', issuer: BRIDGE_ISSUER.publicKey() },
        expectedAmount: '100.0000000',
        plinarfCode: 'PLINARF',
      }),
    ).toThrow(/leg2 asset/);
  });

  it('sem plinarfCode (default PLINARF) aceita PLINARF', () => {
    const xdr = buildSwapXdr('PLINARF');
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey: INV.publicKey(),
        distributorPubkey: DIST.publicKey(),
        issuerPubkey: ISSUER.publicKey(),
        bridgeAsset: { code: 'TESOURO', issuer: BRIDGE_ISSUER.publicKey() },
        expectedAmount: '100.0000000',
      }),
    ).not.toThrow();
  });
});
