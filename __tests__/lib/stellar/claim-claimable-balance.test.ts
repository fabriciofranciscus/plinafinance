import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Transaction } from '@stellar/stellar-sdk';

import { buildClaimClaimableBalanceXdr } from '@/lib/stellar/transactions';
import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';

const INVESTOR_PUBKEY = 'GCV34BIZKP6ATAOI3RTQQ7CRL5KOP3XCEEYQYB3ZD654CMO6XNJQQ5TQ';
// 36-byte CB ID em hex (formato Stellar v0)
const BALANCE_ID =
  '00000000618ee983898fa615b366c1efa396864d5f05808bc91ea0467eb0f0bf360a9af3';

describe('buildClaimClaimableBalanceXdr (PLINA-MOD-007)', () => {
  beforeEach(() => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
      new Account(INVESTOR_PUBKEY, '12345') as unknown as Awaited<
        ReturnType<typeof horizon.loadAccount>
      >,
    );
  });

  it('retorna { xdr, hashHex } com hashHex em formato 0x+64hex', async () => {
    const r = await buildClaimClaimableBalanceXdr({
      investorPubkey: INVESTOR_PUBKEY,
      balanceId: BALANCE_ID,
    });
    expect(r.xdr).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(r.hashHex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('XDR reidratado tem 1 operação claimClaimableBalance com balanceId correto', async () => {
    const { xdr } = await buildClaimClaimableBalanceXdr({
      investorPubkey: INVESTOR_PUBKEY,
      balanceId: BALANCE_ID,
    });
    const tx = new Transaction(xdr, networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as { type: string; balanceId: string };
    expect(op.type).toBe('claimClaimableBalance');
    expect(op.balanceId).toBe(BALANCE_ID);
  });

  it('source da tx é o investor (paga a fee)', async () => {
    const { xdr } = await buildClaimClaimableBalanceXdr({
      investorPubkey: INVESTOR_PUBKEY,
      balanceId: BALANCE_ID,
    });
    const tx = new Transaction(xdr, networkPassphrase);
    expect(tx.source).toBe(INVESTOR_PUBKEY);
  });
});
