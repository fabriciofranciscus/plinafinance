import { describe, it, expect } from 'vitest';
import {
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
} from '@stellar/stellar-sdk';
import { extractLiquidacaoAmount } from '@/lib/stellar/parse-liquidacao-xdr';

const INVESTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
const PLINARF = new Asset('PLINARF', ISSUER);

function buildXdr(opts: {
  source?: string;
  destination?: string;
  asset?: Asset;
  amount?: string;
  ops?: Operation.Operation[];
}): string {
  const source = opts.source ?? INVESTOR;
  const account = new Account(source, '0');
  const builder = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  if (opts.ops) {
    for (const op of opts.ops) builder.addOperation(op);
  } else {
    builder.addOperation(
      Operation.payment({
        destination: opts.destination ?? DISTRIBUTOR,
        asset: opts.asset ?? PLINARF,
        amount: opts.amount ?? '50.0000000',
      }),
    );
  }
  return builder.setTimeout(60).build().toXDR();
}

const VALID = {
  investorPubkey: INVESTOR,
  distributorPubkey: DISTRIBUTOR,
  issuerPubkey: ISSUER,
};

describe('extractLiquidacaoAmount — C-03', () => {
  it('retorna amount da XDR válida', () => {
    expect(extractLiquidacaoAmount(buildXdr({}), VALID)).toBe('50.0000000');
  });

  it('rejeita source ≠ investor', () => {
    expect(() =>
      extractLiquidacaoAmount(buildXdr({ source: OTHER }), VALID),
    ).toThrow(/source/);
  });

  it('rejeita destination ≠ distributor', () => {
    expect(() =>
      extractLiquidacaoAmount(buildXdr({ destination: OTHER }), VALID),
    ).toThrow(/destination/);
  });

  it('rejeita asset ≠ PLINARF', () => {
    expect(() =>
      extractLiquidacaoAmount(
        buildXdr({ asset: new Asset('XLM', ISSUER) }),
        VALID,
      ),
    ).toThrow(/só PLINARF/);
  });

  it('rejeita XDR com 2 ops', () => {
    const xdr = buildXdr({
      ops: [
        Operation.payment({
          destination: DISTRIBUTOR,
          asset: PLINARF,
          amount: '1.0000000',
        }),
        Operation.payment({
          destination: DISTRIBUTOR,
          asset: PLINARF,
          amount: '2.0000000',
        }),
      ],
    });
    expect(() => extractLiquidacaoAmount(xdr, VALID)).toThrow(/1 op/);
  });

  it('rejeita XDR inválida', () => {
    expect(() => extractLiquidacaoAmount('not-xdr', VALID)).toThrow(/inválida/);
  });
});
