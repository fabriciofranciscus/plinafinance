import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Account, Asset, Keypair, Transaction } from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import {
  _resetFeeCacheForTests,
  getDynamicFee,
  getFeeOfertaInvestidor,
  getTaxaBaseDaRede,
} from '@/lib/stellar/fee';
import { buildClaimClaimableBalanceXdr, buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { buildResgateXdr } from '@/lib/stellar/resgate';

/**
 * Taxa em surto da testnet (decisão do Atlas, 15/11 22:23; achado 2 da Vera no E2 em produção).
 * - Builds ASSINADOS PELO INVESTIDOR (swap, resgate, claim) ofertam o p99 do fee_charged, sem cache, com piso
 *   BASE_FEE e teto 100.000 stroops/op. A rede cobra o preço efetivo do ledger, não o máximo ofertado.
 * - `getDynamicFee` (o que a Plina paga: âncora, emissão, auditoria) fica como está: p70 com cache de 5 s.
 * - O swap/submit compara com o mínimo REAL da rede: `last_ledger_base_fee` × ops.
 */
let stats: Record<string, unknown>;
let falha: Error | null;

beforeEach(() => {
  _resetFeeCacheForTests();
  falha = null;
  stats = {
    last_ledger_base_fee: '100',
    fee_charged: { p70: '100', p90: '5000', p99: '22100' },
  };
  vi.spyOn(horizon, 'feeStats').mockImplementation(async () => {
    if (falha) throw falha;
    return stats as never;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('getFeeOfertaInvestidor', () => {
  it('oferta o p99 do fee_charged', async () => {
    expect(await getFeeOfertaInvestidor()).toBe('22100');
  });

  it('nunca abaixo do p70 (p99 ausente → p70)', async () => {
    stats = { fee_charged: { p70: '700' } };
    expect(await getFeeOfertaInvestidor()).toBe('700');
  });

  it('teto 100.000 stroops/op', async () => {
    stats = { fee_charged: { p70: '100', p99: '999999' } };
    expect(await getFeeOfertaInvestidor()).toBe('100000');
  });

  it('piso BASE_FEE (100)', async () => {
    stats = { fee_charged: { p70: '10', p99: '20' } };
    expect(await getFeeOfertaInvestidor()).toBe('100');
  });

  it('sem cache: cada build lê o fee_stats de agora (o "refazer" sai com taxa nova)', async () => {
    expect(await getFeeOfertaInvestidor()).toBe('22100');
    stats = { fee_charged: { p70: '100', p99: '40000' } };
    expect(await getFeeOfertaInvestidor()).toBe('40000');
    expect(horizon.feeStats).toHaveBeenCalledTimes(2);
  });

  it('Horizon fora → cai no getDynamicFee (BASE_FEE)', async () => {
    falha = new Error('horizon down');
    expect(await getFeeOfertaInvestidor()).toBe('100');
  });

  it('não mexe no getDynamicFee (p70 com cache) que a Plina usa', async () => {
    expect(await getDynamicFee()).toBe('100');
    stats = { fee_charged: { p70: '900', p99: '40000' } };
    expect(await getDynamicFee()).toBe('100'); // cache de 5 s
  });
});

describe('getTaxaBaseDaRede (régua do swap/submit)', () => {
  it('devolve last_ledger_base_fee, sem cache', async () => {
    expect(await getTaxaBaseDaRede()).toBe('100');
    stats = { ...stats, last_ledger_base_fee: '250' };
    expect(await getTaxaBaseDaRede()).toBe('250');
  });

  it('não depende do p70/p99 (surto não sobe a régua)', async () => {
    stats = { last_ledger_base_fee: '100', fee_charged: { p70: '22100', p99: '96842' } };
    expect(await getTaxaBaseDaRede()).toBe('100');
  });

  it('ausente, abaixo do protocolo ou Horizon fora → BASE_FEE (100)', async () => {
    stats = { fee_charged: { p70: '100' } };
    expect(await getTaxaBaseDaRede()).toBe('100');
    stats = { last_ledger_base_fee: '1' };
    expect(await getTaxaBaseDaRede()).toBe('100');
    falha = new Error('horizon down');
    expect(await getTaxaBaseDaRede()).toBe('100');
  });
});

describe('builds assinados pelo investidor usam a oferta (p99 × ops)', () => {
  const INV = Keypair.random().publicKey();
  const ISSUER = Keypair.random().publicKey();
  const DIST = Keypair.random().publicKey();
  const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
  const conta = (balances: unknown[]) => Object.assign(new Account(INV, '100'), { balances }) as never;
  const fee = (xdr: string) => Number(new Transaction(xdr, networkPassphrase).fee);

  it('swap (2 ops) → 2 × 22100', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
      conta([{ asset_type: 'credit_alphanum12', asset_code: 'PLINARF', asset_issuer: ISSUER, balance: '0', is_authorized: true }]),
    );
    const { xdr } = await buildSwapBridgeForPlinarfXdr({
      investorPubkey: INV,
      bridgeAsset: TESOURO,
      bridgeAmount: '10.0000000',
      plinarfAmount: '9.0000000',
      issuerPubkey: ISSUER,
      distributorPubkey: DIST,
      plinarfCode: 'PLINARF',
      memo: 'q:teste',
    });
    expect(fee(xdr)).toBe(2 * 22100);
  });

  it('resgate (2 ops) → 2 × 22100', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
      conta([{ asset_type: 'credit_alphanum12', asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), balance: '0', is_authorized: true }]),
    );
    const { xdr } = await buildResgateXdr({
      investorPubkey: INV,
      issuerPubkey: ISSUER,
      distributorPubkey: DIST,
      bridgeAsset: TESOURO,
      plinarfCode: 'PLINARF',
      plinarfAmount: '5.0000000',
      bridgeAmount: '4.0000000',
      memoHash: createHash('sha256').update('pedido').digest(),
    });
    expect(fee(xdr)).toBe(2 * 22100);
  });

  it('claim com changeTrust (2 ops) → 2 × 22100; só o claim → 22100', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([]));
    const bal = '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368';
    const com = await buildClaimClaimableBalanceXdr({ investorPubkey: INV, balanceId: bal, trustAsset: TESOURO });
    expect(fee(com.xdr)).toBe(2 * 22100);
    const so = await buildClaimClaimableBalanceXdr({ investorPubkey: INV, balanceId: bal });
    expect(fee(so.xdr)).toBe(22100);
  });
});
