import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { horizon } from '@/lib/stellar/account';
import { situacaoEnvelopeSwap } from '@/lib/stellar/orfa-swap';

/**
 * N1-S1(b) — reserva órfã do swap: prova de desfecho pela conta do INVESTIDOR
 * (contratos/2026-11-10-n1-orfa-prova.md). Nunca libera por 404 de hash sozinho.
 */
const investidorKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const INVESTOR = investidorKp.publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const TESOURO_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
const MAXTIME = 1_800_000_000;
const S = '42';

function envelope() {
  const tx = new TransactionBuilder(new Account(INVESTOR, '41'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: MAXTIME },
  })
    .addOperation(Operation.payment({ source: INVESTOR, destination: DISTRIBUTOR, asset: new Asset('TESOURO', TESOURO_ISSUER), amount: '99.5000000' }))
    .addOperation(Operation.payment({ source: ISSUER, destination: INVESTOR, asset: new Asset('PLINARF', ISSUER), amount: '97.0000000' }))
    .build();
  tx.sign(investidorKp);
  return { xdr: tx.toXDR(), hash: tx.hash().toString('hex') };
}

const erro404 = () => Object.assign(new Error('not found'), { response: { status: 404 } });
let porHash: (h: string) => Promise<unknown>;
let seqConta: string;
let ultimoFechadoEm: number; // unix s
let txsDaConta: Array<Record<string, unknown>>;
let paginas: number;

function txConta(hash: string, seq: string, successful = true, source = INVESTOR) {
  return { hash, successful, ledger_attr: 555, paging_token: `pt-${hash}`, source_account: source, source_account_sequence: seq };
}

beforeEach(() => {
  porHash = async () => {
    throw erro404();
  };
  seqConta = '41';
  ultimoFechadoEm = MAXTIME + 601;
  txsDaConta = [];
  paginas = 0;
  vi.spyOn(horizon, 'loadAccount').mockImplementation(async (id: string) => {
    expect(id).toBe(INVESTOR);
    return new Account(INVESTOR, seqConta) as never;
  });
  vi.spyOn(horizon, 'transactions').mockImplementation(() => {
    const q: { cursor?: string; limit: number } = { limit: 10 };
    const b = {
      transaction: (h: string) => ({ call: () => porHash(h) }),
      forAccount: () => b,
      order: () => b,
      includeFailed: () => b,
      limit: (n: number) => ((q.limit = n), b),
      cursor: (c: string) => ((q.cursor = c), b),
      call: async () => {
        paginas += 1;
        const i = q.cursor ? txsDaConta.findIndex((r) => r.paging_token === q.cursor) + 1 : 0;
        return { records: txsDaConta.slice(i, i + q.limit) };
      },
    };
    return b as never;
  });
  vi.spyOn(horizon, 'ledgers').mockImplementation(() => {
    const b = {
      order: () => b,
      limit: () => b,
      call: async () => ({
        records: [{ sequence: 9_000, closed_at: new Date(ultimoFechadoEm * 1000).toISOString() }],
      }),
    };
    return b as never;
  });
});

describe('situacaoEnvelopeSwap', () => {
  it('achada pelo hash → ENTROU', async () => {
    const { xdr, hash } = envelope();
    porHash = async (h) => ({ hash: h, successful: true, ledger_attr: 777 });
    expect(await situacaoEnvelopeSwap(xdr)).toEqual({ status: 'ENTROU', hash, successful: true, ledger: 777 });
  });

  it('404 por hash, mas a conta mostra S consumida pela NOSSA tx → ENTROU (nunca libera)', async () => {
    const { xdr, hash } = envelope();
    seqConta = '43';
    txsDaConta = [txConta('depois', '43'), txConta(hash, S), txConta('antes', '41')];
    expect(await situacaoEnvelopeSwap(xdr)).toEqual({ status: 'ENTROU', hash, successful: true, ledger: 555 });
  });

  it('S consumida por OUTRA tx do investidor (salto de sequence) → OUTRA_TX: libera sem operador', async () => {
    const { xdr } = envelope();
    seqConta = '42';
    txsDaConta = [txConta('outra-do-investidor', S)];
    expect(await situacaoEnvelopeSwap(xdr)).toEqual({ status: 'OUTRA_TX', hash: 'outra-do-investidor' });
  });

  it('conta passou de S e a tx com S não aparece → INDETERMINADO (operador), nunca OUTRA_TX', async () => {
    const { xdr } = envelope();
    seqConta = '50';
    txsDaConta = [txConta('x', '50'), txConta('y', '41')];
    expect(await situacaoEnvelopeSwap(xdr)).toMatchObject({ status: 'INDETERMINADO' });
  });

  it('tx de OUTRA conta com a mesma sequence não conta', async () => {
    const { xdr } = envelope();
    seqConta = '42';
    txsDaConta = [txConta('alheia', S, true, DISTRIBUTOR)];
    expect(await situacaoEnvelopeSwap(xdr)).toMatchObject({ status: 'INDETERMINADO' });
  });

  it('paginação: S na 2ª página é achada; teto de 5 páginas → INDETERMINADO', async () => {
    const { xdr } = envelope();
    seqConta = '400';
    txsDaConta = [...Array.from({ length: 200 }, (_, i) => txConta(`a${i}`, String(400 - i))), txConta('outra', S)];
    expect(await situacaoEnvelopeSwap(xdr)).toEqual({ status: 'OUTRA_TX', hash: 'outra' });
    expect(paginas).toBe(2);

    paginas = 0;
    seqConta = '2000';
    txsDaConta = Array.from({ length: 1_200 }, (_, i) => txConta(`b${i}`, String(2000 - i)));
    expect(await situacaoEnvelopeSwap(xdr)).toMatchObject({ status: 'INDETERMINADO' });
    expect(paginas).toBe(5);
  });

  it('S livre e ledger com closed_at > maxTime + 600 → LIVRE_EXPIRADA', async () => {
    const { xdr } = envelope();
    seqConta = '41';
    ultimoFechadoEm = MAXTIME + 601;
    expect(await situacaoEnvelopeSwap(xdr)).toMatchObject({ status: 'LIVRE_EXPIRADA', sequenceConta: '41', ledger: 9_000 });
  });

  it('S livre, mas a rede ainda não passou de maxTime + 600 → AGUARDANDO (relógio local não decide)', async () => {
    const { xdr } = envelope();
    ultimoFechadoEm = MAXTIME + 600;
    expect(await situacaoEnvelopeSwap(xdr)).toEqual({ status: 'AGUARDANDO', liberaApos: MAXTIME + 600 });
  });

  it('esperaSec configurável', async () => {
    const { xdr } = envelope();
    ultimoFechadoEm = MAXTIME + 61;
    expect(await situacaoEnvelopeSwap(xdr, { esperaSec: 60 })).toMatchObject({ status: 'LIVRE_EXPIRADA' });
  });

  it('erro do Horizon propaga (sem decisão)', async () => {
    const { xdr } = envelope();
    porHash = async () => {
      throw Object.assign(new Error('horizon 503'), { response: { status: 503 } });
    };
    await expect(situacaoEnvelopeSwap(xdr)).rejects.toThrow('horizon 503');
  });

  it('envelope sem maxTime → lança', async () => {
    const tx = new TransactionBuilder(new Account(INVESTOR, '41'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(Operation.payment({ source: INVESTOR, destination: DISTRIBUTOR, asset: new Asset('TESOURO', TESOURO_ISSUER), amount: '1' }))
      .build();
    await expect(situacaoEnvelopeSwap(tx.toXDR())).rejects.toThrow(/maxTime/);
  });
});
