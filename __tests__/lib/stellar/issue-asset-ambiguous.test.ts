import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Account, Keypair, Transaction } from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  EmissaoError,
  IssueAssetInputError,
  _setRelogioForTests,
  buildIssueAssetTx,
  buscarTxPorHash,
  issueAsset,
  submitEnvelope,
  txExpirouNaRede,
} from '@/lib/stellar/issuer';
import type { StellarSigner } from '@/lib/stellar/signer';

/**
 * E1-4 — erro ambíguo na emissão. Contratos:
 * contratos/2026-11-10-reemissao-erro-ambiguo.md (Atlas, 10:37) e
 * contratos/2026-11-10-emissao-ambigua-e-supply-erros.md (códigos).
 */
const issuerKp = Keypair.random();
const DESTINO = Keypair.random().publicKey();
const MEMO = Buffer.alloc(32, 9);

const signer: StellarSigner = {
  publicKey: () => issuerKp.publicKey(),
  sign: vi.fn((tx: Transaction) => tx.sign(issuerKp)),
  signatureBase64: () => '',
};

// Relógio falso: dormir avança o tempo, sem esperar de verdade.
let agora = 0;
const dormir = vi.fn(async (ms: number) => {
  agora += ms;
});

const erro504 = () => Object.assign(new Error('timeout'), { response: { status: 504 } });
const erroRede = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const erro400 = (codes: unknown) =>
  Object.assign(new Error('bad request'), {
    response: { status: 400, data: { extras: { result_codes: codes } } },
  });
const erro404 = () => Object.assign(new Error('not found'), { response: { status: 404 } });

function registro(hash: string, successful = true) {
  return {
    hash,
    successful,
    ledger_attr: 123,
    created_at: '2026-11-10T13:00:00Z',
    envelope_xdr: 'env',
    result_xdr: 'res',
    result_meta_xdr: 'meta',
    paging_token: 'pt',
  };
}

const lookup = vi.fn<(hash: string) => Promise<unknown>>();

// Rede falsa (R1 do Argus): o ledger s fecha em REDE_BASE + 5·(s − PRIMEIRO) s.
// O último ledger segue o relógio falso, salvo se `ultimoFixo` o prender.
const PRIMEIRO = 1000;
let REDE_BASE = 0;
let ultimoFixo: number | null = null;
let txsPorLedger = new Map<number, Array<ReturnType<typeof registro>>>();
let contagemDeclarada = new Map<number, number>(); // contagem do registro do ledger
let listaParcial = new Set<number>(); // instância atrasada: lista vazia com 200
let ledgersSumidos = new Set<number>(); // instância que ainda não tem o ledger
const fechamento = (s: number) => REDE_BASE + 5 * (s - PRIMEIRO);
const ultimoLedger = () =>
  ultimoFixo ?? PRIMEIRO + Math.floor((agora / 1000 - REDE_BASE) / 5);
const ledgerDoTempo = (sec: number) => PRIMEIRO + Math.floor((sec - REDE_BASE) / 5);

function registroLedger(s: number) {
  if (s < PRIMEIRO || s > ultimoLedger() || ledgersSumidos.has(s)) throw erro404();
  const n = contagemDeclarada.get(s) ?? (txsPorLedger.get(s)?.length ?? 0);
  return {
    sequence: s,
    closed_at: new Date(fechamento(s) * 1000).toISOString(),
    paging_token: String(s),
    successful_transaction_count: n,
    failed_transaction_count: 0,
  };
}

function ledgersBuilder() {
  const q: { seq?: number; cursor?: string; order: string; limit: number } = {
    order: 'asc',
    limit: 10,
  };
  const b = {
    ledger: (s: number | string) => ((q.seq = Number(s)), b),
    cursor: (c: string) => ((q.cursor = c), b),
    order: (o: string) => ((q.order = o), b),
    limit: (n: number) => ((q.limit = n), b),
    call: async () => {
      if (q.seq !== undefined) return registroLedger(q.seq);
      const passo = q.order === 'desc' ? -1 : 1;
      let s = q.cursor !== undefined ? Number(q.cursor) + passo : q.order === 'desc' ? ultimoLedger() : PRIMEIRO;
      const records = [];
      for (; records.length < q.limit && s >= PRIMEIRO && s <= ultimoLedger(); s += passo) {
        records.push(registroLedger(s));
      }
      return { records };
    },
  };
  return b;
}

function txsBuilder() {
  const q: { ledger?: number; cursor?: string; limit: number } = { limit: 10 };
  const b = {
    transaction: (hash: string) => ({ call: () => lookup(hash) }),
    forLedger: (s: number | string) => ((q.ledger = Number(s)), b),
    includeFailed: () => b,
    order: () => b,
    limit: (n: number) => ((q.limit = n), b),
    cursor: (c: string) => ((q.cursor = c), b),
    call: async () => {
      const s = q.ledger!;
      registroLedger(s); // 404 se a instância não tem o ledger
      if (listaParcial.has(s)) return { records: [] };
      const todos = txsPorLedger.get(s) ?? [];
      const inicio = q.cursor ? todos.findIndex((r) => r.paging_token === q.cursor) + 1 : 0;
      return { records: todos.slice(inicio, inicio + q.limit) };
    },
  };
  return b;
}

/** Põe uma tx (pelo hash) no ledger s, com outras txs de terceiros em volta. */
function colocarNoLedger(s: number, hash: string, successful = true) {
  const lista = Array.from({ length: 3 }, (_, i) => ({
    ...registro(`outra-${s}-${i}`),
    ledger_attr: s,
    paging_token: `${s}-${i}`,
  }));
  lista.splice(1, 0, { ...registro(hash, successful), ledger_attr: s, paging_token: `${s}-x` });
  txsPorLedger.set(s, lista);
}

beforeEach(() => {
  _resetFeeCacheForTests();
  agora = Date.now();
  _setRelogioForTests({ agora: () => agora, dormir });
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockImplementation(
    async () =>
      Object.assign(new Account(issuerKp.publicKey(), '10'), {
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
      }) as never,
  );
  lookup.mockReset().mockImplementation(async () => {
    throw erro404();
  });
  REDE_BASE = Math.floor(agora / 1000) - 1_200;
  ultimoFixo = null;
  txsPorLedger = new Map();
  contagemDeclarada = new Map();
  listaParcial = new Set();
  ledgersSumidos = new Set();
  vi.spyOn(horizon, 'transactions').mockImplementation(() => txsBuilder() as never);
  vi.spyOn(horizon, 'ledgers').mockImplementation(() => ledgersBuilder() as never);
});

afterEach(() => {
  _setRelogioForTests();
});

/** Hash de cada envelope submetido: prova que o reenvio é o MESMO XDR. */
function hashesSubmetidos(): string[] {
  return vi
    .mocked(horizon.submitTransaction)
    .mock.calls.map(([tx]) => (tx as Transaction).hash().toString('hex'));
}

describe('issueAsset — erro ambíguo (despacho E1-4)', () => {
  it('ambíguo, e a tx entra depois → sucesso, uma emissão só', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro504());
    let chamadas = 0;
    lookup.mockImplementation(async (hash: string) => {
      chamadas += 1;
      if (chamadas < 3) throw erro404();
      return registro(hash);
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });

    const hashes = hashesSubmetidos();
    expect(new Set(hashes).size).toBe(1); // sempre o mesmo envelope
    expect(res.hash).toBe(hashes[0]);
    expect(res.successful).toBe(true);
    expect(signer.sign).toHaveBeenCalledTimes(1); // um só envelope assinado
  });

  it('ambíguo, e a tx não entra → lança só depois do maxTime + 10 s', async () => {
    const reenviosEm: number[] = [];
    vi.spyOn(horizon, 'submitTransaction').mockImplementation(async () => {
      reenviosEm.push(agora);
      throw erro504();
    });

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(EmissaoError);
    expect((err as EmissaoError).code).toBe('EMISSAO_NAO_CONFIRMADA');
    const maxTime = (err as EmissaoError).maxTime!;
    expect(agora).toBeGreaterThanOrEqual((maxTime + 10) * 1000);
    // Nenhum reenvio depois do maxTime; todos com o mesmo hash.
    expect(reenviosEm.every((t) => t < maxTime * 1000)).toBe(true);
    expect(new Set(hashesSubmetidos()).size).toBe(1);
  });

  it('definitivo (result_codes) → lança EMISSAO_FALHOU na hora', async () => {
    const codes = { transaction: 'tx_failed', operations: ['op_no_trust'] };
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro400(codes));

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(EmissaoError);
    expect((err as EmissaoError).code).toBe('EMISSAO_FALHOU');
    expect((err as EmissaoError).resultCodes).toEqual(codes);
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('ambíguo e a tx entrou com falha → EMISSAO_FALHOU, não reemite', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erroRede());
    lookup.mockImplementation(async (hash: string) => registro(hash, false));

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect((err as EmissaoError).code).toBe('EMISSAO_FALHOU');
    expect(new Set(hashesSubmetidos()).size).toBe(1);
  });

  it('reenvio dá tx_bad_seq e a tx aparece pelo hash → sucesso', async () => {
    vi.spyOn(horizon, 'submitTransaction')
      .mockRejectedValueOnce(erro504())
      .mockRejectedValue(erro400({ transaction: 'tx_bad_seq' }));
    let chamadas = 0;
    lookup.mockImplementation(async (hash: string) => {
      chamadas += 1;
      if (chamadas < 2) throw erro404();
      return registro(hash);
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF');
    expect(res.successful).toBe(true);
  });

  it('se a consulta final ao Horizon falha, propaga o erro (não afirma que não entrou)', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro504());
    lookup.mockImplementation(async () => {
      throw Object.assign(new Error('horizon 503'), { response: { status: 503 } });
    });

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(EmissaoError);
    expect((err as Error).message).toBe('horizon 503');
  });
});

describe('primitivas (contrato das 10:37)', () => {
  it('buildIssueAssetTx devolve envelope assinado, hash e maxTime', async () => {
    const b = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
    });
    const tx = new Transaction(b.xdr, networkPassphrase);
    expect(tx.signatures).toHaveLength(1);
    expect(b.hash).toBe(tx.hash().toString('hex'));
    expect(b.maxTime).toBe(Number(tx.timeBounds?.maxTime));
    expect(tx.memo.type).toBe('hash');
  });

  it('buildIssueAssetTx valida antes de carregar a conta ou assinar', async () => {
    const err = await buildIssueAssetTx(signer, DESTINO, '0', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(IssueAssetInputError);
    expect(horizon.loadAccount).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('submitEnvelope classifica sucesso, definitivo e ambíguo', async () => {
    const { xdr, hash } = await buildIssueAssetTx(signer, DESTINO, '1', 'PLINARF');
    const submit = vi.spyOn(horizon, 'submitTransaction');

    submit.mockResolvedValueOnce({ hash, successful: true } as never);
    expect(await submitEnvelope(xdr)).toMatchObject({ status: 'SUCCESS', hash });

    submit.mockRejectedValueOnce(erro400({ transaction: 'tx_insufficient_balance' }));
    expect(await submitEnvelope(xdr)).toEqual({
      status: 'FAILED',
      hash,
      resultCodes: { transaction: 'tx_insufficient_balance' },
    });

    for (const e of [erro504(), erroRede(), Object.assign(new Error('x'), { response: { status: 500 } })]) {
      submit.mockRejectedValueOnce(e);
      expect(await submitEnvelope(xdr)).toMatchObject({ status: 'AMBIGUOUS', hash });
    }
  });

  it('submitEnvelope: tx_bad_seq sem a tx no ledger vira AMBIGUOUS (pode estar entrando)', async () => {
    const { xdr, hash } = await buildIssueAssetTx(signer, DESTINO, '1', 'PLINARF');
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValueOnce(
      erro400({ transaction: 'tx_bad_seq' }),
    );
    expect(await submitEnvelope(xdr)).toMatchObject({ status: 'AMBIGUOUS', hash });
  });

  it('buscarTxPorHash: achou, não achou (404) e erro propaga', async () => {
    lookup.mockResolvedValueOnce(registro('h1'));
    expect(await buscarTxPorHash('h1')).toEqual({
      found: true,
      successful: true,
      ledgerCloseTime: '2026-11-10T13:00:00Z',
    });

    lookup.mockRejectedValueOnce(erro404());
    expect(await buscarTxPorHash('h2')).toEqual({ found: false });

    lookup.mockRejectedValueOnce(Object.assign(new Error('horizon 500'), { response: { status: 500 } }));
    await expect(buscarTxPorHash('h3')).rejects.toThrow('horizon 500');
  });
});

describe('txExpirouNaRede — R1 do Argus (expiração pelo ledger do Horizon)', () => {
  async function envelope() {
    return buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
  }

  it('a rede ainda não fechou ledger depois do maxTime → EM_ABERTO, mesmo com o relógio local adiantado', async () => {
    const env = await envelope();
    agora = (env.maxTime + 3_600) * 1000; // relógio local 1 h à frente
    ultimoFixo = ledgerDoTempo(env.maxTime); // rede parada antes do prazo

    expect(await txExpirouNaRede(env.xdr)).toEqual({
      status: 'EM_ABERTO',
      hash: env.hash,
      maxTime: env.maxTime,
    });
  });

  it('ledger depois do maxTime fechado e a tx em nenhum ledger da janela → EXPIROU', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    for (let s = ledgerDoTempo(env.maxTime - 150); s <= ledgerDoTempo(env.maxTime); s += 4) {
      colocarNoLedger(s, `terceiro-${s}`);
    }

    const r = await txExpirouNaRede(env.xdr);

    expect(r).toMatchObject({ status: 'EXPIROU', hash: env.hash, maxTime: env.maxTime });
    const ledgerAposPrazo = (r as { ledgerAposPrazo: number }).ledgerAposPrazo;
    expect(fechamento(ledgerAposPrazo)).toBeGreaterThan(env.maxTime);
    expect(fechamento(ledgerAposPrazo - 1)).toBeLessThanOrEqual(env.maxTime);
  });

  it('busca por hash dá 404 (instância atrasada), mas a tx está num ledger da janela → ENTROU, não EXPIROU', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    const ledgerDaTx = ledgerDoTempo(env.maxTime - 30);
    colocarNoLedger(ledgerDaTx, env.hash);
    // lookup por hash segue 404 (beforeEach): o cenário de emissão dupla do Argus.

    expect(await txExpirouNaRede(env.xdr)).toEqual({
      status: 'ENTROU',
      hash: env.hash,
      successful: true,
      ledger: ledgerDaTx,
    });
  });

  it('tx achada pelo hash → ENTROU sem varrer ledgers', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    lookup.mockImplementation(async (hash: string) => registro(hash, false));

    expect(await txExpirouNaRede(env.xdr)).toEqual({
      status: 'ENTROU',
      hash: env.hash,
      successful: false,
      ledger: 123,
    });
    expect(horizon.ledgers).not.toHaveBeenCalled();
  });

  it('lista de um ledger menor que a contagem do ledger (instância atrasada) → erro, nunca EXPIROU', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    const s = ledgerDoTempo(env.maxTime - 30);
    colocarNoLedger(s, env.hash);
    listaParcial.add(s);

    await expect(txExpirouNaRede(env.xdr)).rejects.toThrow(/indeterminad/i);
  });

  it('ledger da janela ausente na instância (404) → erro, nunca EXPIROU', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    ledgersSumidos.add(ledgerDoTempo(env.maxTime - 60));

    await expect(txExpirouNaRede(env.xdr)).rejects.toThrow();
  });

  it('a janela cobre o caso da tx entrar logo depois de montada, com folga de relógio', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    const ledgerDaTx = ledgerDoTempo(env.maxTime - 120 - 200); // relógio local 200 s adiantado
    colocarNoLedger(ledgerDaTx, env.hash);

    expect(await txExpirouNaRede(env.xdr)).toMatchObject({ status: 'ENTROU', ledger: ledgerDaTx });
  });
});

describe('issueAsset decide o desfecho pela rede, não pelo relógio local (R1)', () => {
  it('ambíguo, 404 por hash até o fim, mas a tx está no ledger → sucesso, sem EMISSAO_NAO_CONFIRMADA', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockImplementation(async (tx) => {
      const t = tx as Transaction;
      colocarNoLedger(ledgerDoTempo(Number(t.timeBounds!.maxTime) - 100), t.hash().toString('hex'));
      throw erro504();
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });

    expect(res.successful).toBe(true);
    expect(res.hash).toBe(hashesSubmetidos()[0]);
    expect(signer.sign).toHaveBeenCalledTimes(1);
  });

  it('rede sem ledger depois do maxTime → erro sem desfecho, nunca EMISSAO_NAO_CONFIRMADA', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro504());
    ultimoFixo = ledgerDoTempo(Math.floor(agora / 1000));

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(EmissaoError);
    expect((err as Error).message).toMatch(/indeterminad/i);
  });
});

describe('reemissão sai da mesma conta-fonte (R1)', () => {
  it('nova tentativa depois de EXPIROU: mesma source (issuer) e sequence recarregada da conta', async () => {
    const a = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    const b = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    const ta = new Transaction(a.xdr, networkPassphrase);
    const tb = new Transaction(b.xdr, networkPassphrase);

    expect(ta.source).toBe(issuerKp.publicKey());
    expect(tb.source).toBe(issuerKp.publicKey());
    expect(tb.sequence).toBe(ta.sequence); // mesma sequence: no máximo uma das duas entra
    expect(vi.mocked(horizon.loadAccount).mock.calls.every(([k]) => k === issuerKp.publicKey())).toBe(true);
  });
});
