import { describe, it, expect, vi } from 'vitest';
import { Account, Asset, Keypair } from '@stellar/stellar-sdk';
import { horizon } from '@/lib/stellar/account';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

/**
 * Contrato N1: o envelope que o PRÓPRIO build gera passa no validador
 * endurecido (janela, prazo do quote, sem precondições v2, memo do build).
 */
const INVESTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const TESOURO_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();

describe('build do swap → validador (contrato N1)', () => {
  it('o envelope do buildSwapBridgeForPlinarfXdr passa com quoteExpiresAt e memoTexto', async () => {
    _resetFeeCacheForTests();
    vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
      // N1-at: investidor com trustline PLINARF autorizada.
      Object.assign(new Account(INVESTOR, '42'), { balances: [{ asset_type: 'credit_alphanum12', asset_code: 'PLINARF', asset_issuer: ISSUER, balance: '0', is_authorized: true }] }) as never,
    );
    const memo = 'q:quote-abc-123';

    const { xdr } = await buildSwapBridgeForPlinarfXdr({
      investorPubkey: INVESTOR,
      bridgeAsset: new Asset('TESOURO', TESOURO_ISSUER),
      bridgeAmount: '99.5000000',
      plinarfAmount: '97.1234567',
      issuerPubkey: ISSUER,
      distributorPubkey: DISTRIBUTOR,
      memo,
    });

    expect(() =>
      assertSwapXdrMatchesQuote(xdr, {
        investorPubkey: INVESTOR,
        distributorPubkey: DISTRIBUTOR,
        issuerPubkey: ISSUER,
        bridgeAsset: { code: 'TESOURO', issuer: TESOURO_ISSUER },
        expectedBridgeAmount: '99.5000000',
        expectedPlinarfAmount: '97.1234567',
        quoteExpiresAt: new Date(Date.now() + 5 * 60_000), // quote renovado dura 5 min
        memoTexto: memo,
      }),
    ).not.toThrow();
  });
});
