import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { attachInvestorSignature } from '../signed-xdr';

const investor = Keypair.random();
const other = Keypair.random();

function buildXdr(): string {
  return new TransactionBuilder(new Account(investor.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: other.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

describe('attachInvestorSignature', () => {
  it('anexa a assinatura do investidor e ela verifica contra o hash da tx', () => {
    const xdr = buildXdr();
    const tx = new Transaction(xdr, Networks.TESTNET);
    const sig = investor.sign(tx.hash());

    const signed = attachInvestorSignature(xdr, investor.publicKey(), `0x${sig.toString('hex')}`);

    const out = new Transaction(signed, Networks.TESTNET);
    expect(out.signatures).toHaveLength(1);
    expect(out.signatures[0]!.hint()).toEqual(investor.signatureHint());
    expect(investor.verify(out.hash(), out.signatures[0]!.signature())).toBe(true);
    // O corpo da transação não muda: mesmo hash.
    expect(out.hash()).toEqual(tx.hash());
  });

  it('aceita hex sem prefixo 0x', () => {
    const xdr = buildXdr();
    const sig = investor.sign(new Transaction(xdr, Networks.TESTNET).hash());
    const signed = attachInvestorSignature(xdr, investor.publicKey(), sig.toString('hex'));
    expect(new Transaction(signed, Networks.TESTNET).signatures).toHaveLength(1);
  });

  it('recusa assinatura que não é Ed25519 de 64 bytes', () => {
    expect(() => attachInvestorSignature(buildXdr(), investor.publicKey(), '0xfeed')).toThrow(
      /Assinatura inválida/,
    );
  });

  it('recusa pubkey inválida e XDR que não é transação', () => {
    const hex = `0x${'ab'.repeat(64)}`;
    expect(() => attachInvestorSignature(buildXdr(), 'GINVALID', hex)).toThrow(/pubkey/);
    expect(() => attachInvestorSignature('nao-e-xdr', investor.publicKey(), hex)).toThrow();
  });
});
