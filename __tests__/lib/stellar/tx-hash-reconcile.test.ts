import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Transaction } from '@stellar/stellar-sdk';

import {
  buildClaimClaimableBalanceXdr,
  txHashFromXdr,
  fetchTransactionByHash,
} from '@/lib/stellar/transactions';
import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';

const INVESTOR_PUBKEY = 'GCV34BIZKP6ATAOI3RTQQ7CRL5KOP3XCEEYQYB3ZD654CMO6XNJQQ5TQ';
const BALANCE_ID =
  '00000000618ee983898fa615b366c1efa396864d5f05808bc91ea0467eb0f0bf360a9af3';

/** Encadeia horizon.transactions().transaction(hash).call() pro mock. */
function mockTransactionCall(impl: () => Promise<unknown>) {
  return vi.spyOn(horizon, 'transactions').mockReturnValue({
    transaction: () => ({ call: impl }),
  } as unknown as ReturnType<typeof horizon.transactions>);
}

describe('txHashFromXdr (#6)', () => {
  beforeEach(() => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
      new Account(INVESTOR_PUBKEY, '12345') as unknown as Awaited<
        ReturnType<typeof horizon.loadAccount>
      >,
    );
  });

  it('é determinístico e bate com tx.hash() do SDK (hex sem 0x)', async () => {
    const { xdr } = await buildClaimClaimableBalanceXdr({
      investorPubkey: INVESTOR_PUBKEY,
      balanceId: BALANCE_ID,
    });
    const expected = new Transaction(xdr, networkPassphrase)
      .hash()
      .toString('hex');
    expect(txHashFromXdr(xdr)).toBe(expected);
    // Determinístico: duas chamadas idênticas.
    expect(txHashFromXdr(xdr)).toBe(txHashFromXdr(xdr));
    expect(txHashFromXdr(xdr)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fetchTransactionByHash (#6)', () => {
  it('retorna { hash, successful } quando a tx existe', async () => {
    mockTransactionCall(async () => ({ hash: 'abc', successful: true }));
    await expect(fetchTransactionByHash('abc')).resolves.toEqual({
      hash: 'abc',
      successful: true,
    });
  });

  it('retorna null em 404 (tx não aplicada — seguro submeter)', async () => {
    mockTransactionCall(async () => {
      throw { response: { status: 404 } };
    });
    await expect(fetchTransactionByHash('nope')).resolves.toBeNull();
  });

  it('propaga erros que não são 404', async () => {
    mockTransactionCall(async () => {
      throw { response: { status: 500 } };
    });
    await expect(fetchTransactionByHash('boom')).rejects.toBeDefined();
  });
});
