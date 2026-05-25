import { describe, it, expect } from 'vitest';
import {
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
} from '@stellar/stellar-sdk';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

// Pubkeys determinísticas pra testes — geradas a partir de seeds fixas.
const INVESTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const TESOURO_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();

const ASSET_CODE = 'PLINARF';
const BRIDGE = { code: 'TESOURO', issuer: TESOURO_ISSUER };
const PLINARF = new Asset(ASSET_CODE, ISSUER);
const TESOURO = new Asset(BRIDGE.code, BRIDGE.issuer);

function buildXdr(opts: {
  source?: string;
  ops?: Array<unknown>;
  amount1?: string;
  amount2?: string;
  asset1?: Asset;
  asset2?: Asset;
  dest1?: string;
  source2?: string;
  dest2?: string;
}): string {
  const source = opts.source ?? INVESTOR;
  const account = new Account(source, '0');
  const builder = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  if (opts.ops) {
    // custom override usage
    for (const op of opts.ops as Parameters<typeof builder.addOperation>[0][]) {
      builder.addOperation(op);
    }
  } else {
    builder.addOperation(
      Operation.payment({
        source: INVESTOR,
        destination: opts.dest1 ?? DISTRIBUTOR,
        asset: opts.asset1 ?? TESOURO,
        amount: opts.amount1 ?? '99.5000000',
      }),
    );
    builder.addOperation(
      Operation.payment({
        source: opts.source2 ?? DISTRIBUTOR,
        destination: opts.dest2 ?? INVESTOR,
        asset: opts.asset2 ?? PLINARF,
        amount: opts.amount2 ?? '99.5000000',
      }),
    );
  }
  return builder.setTimeout(60).build().toXDR();
}

const VALID_EXPECT = {
  investorPubkey: INVESTOR,
  distributorPubkey: DISTRIBUTOR,
  issuerPubkey: ISSUER,
  bridgeAsset: BRIDGE,
  expectedAmount: '99.5000000',
};

describe('assertSwapXdrMatchesQuote — C-01', () => {
  it('XDR válida passa', () => {
    expect(() => assertSwapXdrMatchesQuote(buildXdr({}), VALID_EXPECT)).not.toThrow();
  });

  it('rejeita amount inflado na leg PLINARF', () => {
    const xdr = buildXdr({ amount2: '999.0000000' });
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/leg2 amount/);
  });

  it('rejeita amount inflado na leg TESOURO', () => {
    const xdr = buildXdr({ amount1: '999.0000000' });
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/leg1 amount/);
  });

  it('rejeita asset errado na leg PLINARF', () => {
    const xdr = buildXdr({
      asset2: new Asset('FAKE', ISSUER),
    });
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/leg2 asset/);
  });

  it('rejeita destino errado na leg PLINARF', () => {
    const attacker = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
    const xdr = buildXdr({ dest2: attacker });
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/leg2 destination/);
  });

  it('rejeita XDR com source ≠ investor', () => {
    const xdr = buildXdr({ source: DISTRIBUTOR });
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/source/);
  });

  it('rejeita XDR com 1 op só', () => {
    const account = new Account(INVESTOR, '0');
    const xdr = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: DISTRIBUTOR,
          asset: TESOURO,
          amount: '99.5000000',
        }),
      )
      .setTimeout(60)
      .build()
      .toXDR();
    expect(() => assertSwapXdrMatchesQuote(xdr, VALID_EXPECT)).toThrow(/2 ops/);
  });

  it('rejeita XDR inválida', () => {
    expect(() => assertSwapXdrMatchesQuote('not-xdr', VALID_EXPECT)).toThrow(
      /xdr inválida/,
    );
  });
});
