import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

function buildTx(pubkey: string) {
  const account = new Account(pubkey, '0');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: pubkey,
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(60)
    .build();
}

describe('KeypairSigner', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STELLAR_NETWORK;
  });

  it('publicKey espelha o Keypair', async () => {
    const kp = Keypair.random();
    const { KeypairSigner } = await import('@/lib/stellar/signer');
    expect(new KeypairSigner(kp.secret()).publicKey()).toBe(kp.publicKey());
  });

  it('sign anexa uma assinatura à tx', async () => {
    const kp = Keypair.random();
    const { KeypairSigner } = await import('@/lib/stellar/signer');
    const tx = buildTx(kp.publicKey());
    expect(tx.signatures.length).toBe(0);
    new KeypairSigner(kp.secret()).sign(tx);
    expect(tx.signatures.length).toBe(1);
  });

  it('signatureBase64 bate com a assinatura crua do Keypair', async () => {
    const kp = Keypair.random();
    const { KeypairSigner } = await import('@/lib/stellar/signer');
    const tx = buildTx(kp.publicKey());
    const expected = kp.sign(tx.hash()).toString('base64');
    expect(new KeypairSigner(kp.secret()).signatureBase64(tx)).toBe(expected);
  });
});

describe('issuerSigner / distributorSigner — guard de mainnet', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.FIREBLOCKS_API_KEY;
    delete process.env.FIREBLOCKS_API_SECRET;
  });

  it('TESTNET → KeypairSigner do secret em env', async () => {
    delete process.env.STELLAR_NETWORK;
    const secret = Keypair.random().secret();
    process.env.STELLAR_ISSUER_SECRET = secret;
    const { issuerSigner } = await import('@/lib/stellar/signer');
    expect(issuerSigner().publicKey()).toBe(
      Keypair.fromSecret(secret).publicKey(),
    );
  });

  it('PUBLIC sem Fireblocks → lança (fail-closed)', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    process.env.STELLAR_ISSUER_SECRET = Keypair.random().secret();
    const { issuerSigner } = await import('@/lib/stellar/signer');
    expect(() => issuerSigner()).toThrow(/Fireblocks/);
  });

  it('PUBLIC com Fireblocks → ainda lança (FireblocksSigner é Fase 2)', async () => {
    process.env.STELLAR_NETWORK = 'PUBLIC';
    process.env.FIREBLOCKS_API_KEY = 'k';
    process.env.FIREBLOCKS_API_SECRET = 's';
    const { distributorSigner } = await import('@/lib/stellar/signer');
    expect(() => distributorSigner()).toThrow(/Fase 2/);
  });

  it('TESTNET sem secret → lança ausência', async () => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_DISTRIBUTOR_SECRET;
    const { distributorSigner } = await import('@/lib/stellar/signer');
    expect(() => distributorSigner()).toThrow(/ausente/);
  });
});
