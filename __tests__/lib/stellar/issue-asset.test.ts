import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Asset, Keypair, type Transaction } from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import { IssueAssetInputError, issueAsset } from '@/lib/stellar/issuer';
import type { StellarSigner } from '@/lib/stellar/signer';

/**
 * E1-4: `issueAsset` exige o code (sem default) e recusa amount fora do
 * formato Stellar ANTES de ir à rede ou assinar. Contrato:
 * contratos/2026-11-09-issue-asset-code-obrigatorio.md.
 */
const issuerKp = Keypair.random();
const DISTRIBUTOR = Keypair.random().publicKey();

const signer: StellarSigner = {
  publicKey: () => issuerKp.publicKey(),
  sign: vi.fn((tx: Transaction) => tx.sign(issuerKp)),
  signatureBase64: () => '',
};

let submetida: Transaction | undefined;

beforeEach(() => {
  _resetFeeCacheForTests();
  submetida = undefined;
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockImplementation(async () =>
    Object.assign(new Account(issuerKp.publicKey(), '10'), {
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    }) as never,
  );
  vi.spyOn(horizon, 'submitTransaction').mockImplementation(async (tx) => {
    submetida = tx as Transaction;
    return { hash: 'h', successful: true } as never;
  });
});

async function recusa(amount: unknown, ...codeArg: unknown[]) {
  // Sem 2º argumento = PLINARF; `undefined` explícito chega como undefined.
  const code = codeArg.length ? codeArg[0] : 'PLINARF';
  const err = await (issueAsset as (...a: unknown[]) => Promise<unknown>)(
    signer,
    DISTRIBUTOR,
    amount,
    code,
  ).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(IssueAssetInputError);
  // Nada de rede nem assinatura quando a entrada é inválida.
  expect(horizon.loadAccount).not.toHaveBeenCalled();
  expect(horizon.submitTransaction).not.toHaveBeenCalled();
  return err as IssueAssetInputError;
}

describe('issueAsset — recusas (fail-closed)', () => {
  it('sem code', async () => {
    const err = await recusa('400.0000000', undefined);
    expect(err.code).toBe('ISSUE_CODE_UNKNOWN');
  });

  it('code que não é da Plina', async () => {
    const err = await recusa('400.0000000', 'USDC');
    expect(err.code).toBe('ISSUE_CODE_UNKNOWN');
  });

  it('amount 0', async () => {
    expect((await recusa('0')).code).toBe('ISSUE_AMOUNT_INVALID');
    expect((await recusa('0.0000000')).code).toBe('ISSUE_AMOUNT_INVALID');
  });

  it('amount com 8 casas', async () => {
    expect((await recusa('1.12345678')).code).toBe('ISSUE_AMOUNT_INVALID');
  });

  it('amount negativo, expoente, espaço, vazio, número ou acima do máximo Stellar', async () => {
    for (const bad of ['-1', '1e3', ' 1', '1 ', '', '.5', '1.', 100, '922337203685.4775808']) {
      expect((await recusa(bad)).code).toBe('ISSUE_AMOUNT_INVALID');
    }
  });
});

describe('issueAsset — aceitos', () => {
  it('emite o asset do code pedido, no amount pedido, para o destino', async () => {
    await issueAsset(signer, DISTRIBUTOR, '376.4705882', 'PLINARFB');

    expect(submetida).toBeDefined();
    const [op] = submetida!.operations as unknown as Array<{
      type: string;
      destination: string;
      asset: Asset;
      amount: string;
    }>;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(DISTRIBUTOR);
    expect(op.asset.getCode()).toBe('PLINARFB');
    expect(op.asset.getIssuer()).toBe(issuerKp.publicKey());
    expect(op.amount).toBe('376.4705882');
  });

  it('aceita inteiro sem casas e o máximo Stellar', async () => {
    await issueAsset(signer, DISTRIBUTOR, '400', 'PLINARF');
    await issueAsset(signer, DISTRIBUTOR, '922337203685.4775807', 'PLINARF');
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(2);
  });
});
