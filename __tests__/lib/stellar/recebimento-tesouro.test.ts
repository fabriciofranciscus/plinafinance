import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import { horizon } from '@/lib/stellar/account';
import { tesouroRecebidoDaOrdem } from '@/lib/stellar/recebimento';

/**
 * Valor de TESOURO entregue PARA UMA ORDEM, lido na chain (desenho passagens/2026-11-16-estela-desenho-tesouro-recebido-menor.md;
 * decisão do Atlas: o fix do A3 vem primeiro — o swap só sai depois que o TESOURO da própria ordem aparece na rede).
 * Fixtures com valores reais da produção-testnet (conta de teste GCSVOACZ…, 16/11).
 */
const INV = 'GCSVOACZK3BFEK24N7CAGZQHWKYTIO6LLDZET2GZBQWH2RWF7TKMF4DH';
const TESOURO = new Asset('TESOURO', 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4');
const FALSO = new Asset('TESOURO', Keypair.random().publicKey());
const OUTRO = Keypair.random().publicKey();
const ENTREGA = '5b13c3cf7ef4b611b7dc8c7e284674a6ff579d572ccd20bfdac9a83535064afa';
const CLAIM = '591e68576e125e625d057dd5817a9096fd4f82cee1a956fb3f628b52ba4eb383';
const CB = '00000000d5f4a6475a9ff2a27af534154520d8f9608d17639c1131fdcb3a0d7324f639f6';

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

let ops: Record<string, Array<Record<string, unknown>> | Error>;
let efeitos: Record<string, Array<Record<string, unknown>> | Error>;
let cbs: Record<string, Record<string, unknown> | Error>;

beforeEach(() => {
  ops = {};
  efeitos = {};
  cbs = {};
  const res = <T,>(v: T | Error | undefined) => (v instanceof Error ? Promise.reject(v) : v === undefined ? Promise.reject(http(404)) : Promise.resolve(v));
  vi.spyOn(horizon, 'operations').mockReturnValue({
    forTransaction: (h: string) => ({ limit: () => ({ call: () => res(ops[h] === undefined ? undefined : ops[h] instanceof Error ? ops[h] : { records: ops[h] }) }) }),
  } as never);
  vi.spyOn(horizon, 'effects').mockReturnValue({
    forTransaction: (h: string) => ({ limit: () => ({ call: () => res(efeitos[h] === undefined ? undefined : efeitos[h] instanceof Error ? efeitos[h] : { records: efeitos[h] }) }) }),
  } as never);
  vi.spyOn(horizon, 'claimableBalances').mockReturnValue({
    claimableBalance: (id: string) => ({ call: () => res(cbs[id]) }),
  } as never);
});
afterEach(() => vi.restoreAllMocks());

const mint = (over: Record<string, unknown> = {}) => ({
  transaction_successful: true,
  asset_balance_changes: [
    { asset_type: 'credit_alphanum12', asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), type: 'mint', to: INV, amount: '85.4921510', ...over },
  ],
});

describe('entrega direta (mint/transfer do contrato do TESOURO)', () => {
  it('soma o que chegou ao investidor no ativo certo', async () => {
    ops[ENTREGA] = [mint()];
    expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA })).toEqual({
      status: 'RECEBIDO', valor: '85.4921510', via: 'ENTREGA_DIRETA', ref: ENTREGA,
    });
  });

  it('transfer também conta; várias mudanças para o investidor somam', async () => {
    ops[ENTREGA] = [
      { transaction_successful: true, asset_balance_changes: [
        { asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), type: 'transfer', from: OUTRO, to: INV, amount: '50.0000000' },
        { asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), type: 'mint', to: INV, amount: '35.4921510' },
      ] },
    ];
    const r = await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA });
    expect(r).toMatchObject({ status: 'RECEBIDO', valor: '85.4921510' });
  });

  it('ignora outro destinatário, outro emissor e burn', async () => {
    ops[ENTREGA] = [
      { transaction_successful: true, asset_balance_changes: [
        { asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), type: 'mint', to: OUTRO, amount: '10' },
        { asset_code: 'TESOURO', asset_issuer: FALSO.getIssuer(), type: 'mint', to: INV, amount: '10' },
        { asset_code: 'TESOURO', asset_issuer: TESOURO.getIssuer(), type: 'burn', from: INV, amount: '10' },
      ] },
    ];
    expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA })).toEqual({
      status: 'NAO_CONFERE', motivo: 'a transação da ordem não entrega TESOURO a esta carteira',
    });
  });

  it('tx falhada não conta', async () => {
    ops[ENTREGA] = [{ ...mint(), transaction_successful: false }];
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA })).status).toBe('NAO_CONFERE');
  });

  it('tx ainda não visível na rede (404) → NAO_CHEGOU (o A3: não libera o swap)', async () => {
    expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA })).toEqual({ status: 'NAO_CHEGOU' });
  });

  it('erro do Horizon que não é 404 propaga (a rota responde 503)', async () => {
    ops[ENTREGA] = http(503);
    await expect(tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: ENTREGA })).rejects.toThrow();
  });
});

describe('claimable balance', () => {
  it('CB ainda aberto, com o investidor como claimant e o ativo certo → CB_PENDENTE com o valor', async () => {
    cbs[CB] = { id: CB, asset: `TESOURO:${TESOURO.getIssuer()}`, amount: '85.4925290', claimants: [{ destination: INV }] };
    expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB })).toEqual({
      status: 'CB_PENDENTE', valor: '85.4925290', ref: CB,
    });
  });

  it('CB de outro ativo ou sem o investidor → NAO_CONFERE', async () => {
    cbs[CB] = { id: CB, asset: `TESOURO:${FALSO.getIssuer()}`, amount: '85', claimants: [{ destination: INV }] };
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB })).status).toBe('NAO_CONFERE');
    cbs[CB] = { id: CB, asset: `TESOURO:${TESOURO.getIssuer()}`, amount: '85', claimants: [{ destination: OUTRO }] };
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB })).status).toBe('NAO_CONFERE');
  });

  it('CB já resgatado: o valor vem do efeito claimable_balance_claimed do claim da ordem', async () => {
    efeitos[CLAIM] = [
      { type: 'trustline_created', account: INV },
      { type: 'claimable_balance_claimed', account: INV, balance_id: CB, asset: `TESOURO:${TESOURO.getIssuer()}`, amount: '85.4925290' },
    ];
    expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB, claimTxHash: CLAIM })).toEqual({
      status: 'RECEBIDO', valor: '85.4925290', via: 'CLAIM', ref: CLAIM,
    });
  });

  it('CB sumiu e não há claim conferível → INDETERMINADO (não libera)', async () => {
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB })).status).toBe('INDETERMINADO');
    efeitos[CLAIM] = [{ type: 'claimable_balance_claimed', account: OUTRO, balance_id: CB, asset: `TESOURO:${TESOURO.getIssuer()}`, amount: '85' }];
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB, claimTxHash: CLAIM })).status).toBe('INDETERMINADO');
  });
});

describe('gate da Vera (def9c75): lacunas de teste', () => {
  it('claim de OUTRO balance_id → INDETERMINADO (a mutação sem a checagem de balance_id sobrevivia)', async () => {
    efeitos[CLAIM] = [
      { type: 'claimable_balance_claimed', account: INV, balance_id: '00000000' + 'ab'.repeat(32), asset: `TESOURO:${TESOURO.getIssuer()}`, amount: '85.4925290' },
    ];
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB, claimTxHash: CLAIM })).status).toBe('INDETERMINADO');
  });

  it('hash malformado → estado, sem chamar o Horizon', async () => {
    const opsSpy = vi.spyOn(horizon, 'operations');
    for (const h of ['xyz', 'A'.repeat(64), '0'.repeat(63), "5b13c3cf' or 1=1"]) {
      expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarTxHash: h })).toEqual({
        status: 'NAO_CONFERE', motivo: 'hash de entrega malformado',
      });
    }
    expect((await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO, stellarClaimableBalanceId: CB, claimTxHash: 'nao-hex' })).status).toBe('INDETERMINADO');
    expect(opsSpy).not.toHaveBeenCalled();
  });
});

it('ordem sem CB nem hash de entrega → NAO_CHEGOU', async () => {
  expect(await tesouroRecebidoDaOrdem({ investorPubkey: INV, ativo: TESOURO })).toEqual({ status: 'NAO_CHEGOU' });
});
