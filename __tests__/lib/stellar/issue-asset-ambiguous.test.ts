import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Account, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

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
  quemConsumiuSequence,
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
// accounts/{issuer}/transactions (desc): o que a instância do Horizon mostra da conta.
let txsDaConta: Array<Record<string, unknown>> = [];
let contaConsultada: string | undefined;
let paginasDaConta = 0;
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
    forAccount: (conta: string) => ((contaConsultada = conta), (q.ledger = -1), b),
    includeFailed: () => b,
    order: () => b,
    limit: (n: number) => ((q.limit = n), b),
    cursor: (c: string) => ((q.cursor = c), b),
    call: async () => {
      const s = q.ledger!;
      if (s === -1) {
        paginasDaConta += 1;
        const inicio = q.cursor ? txsDaConta.findIndex((r) => r.paging_token === q.cursor) + 1 : 0;
        return { records: txsDaConta.slice(inicio, inicio + q.limit) };
      }
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
  txsDaConta = [];
  contaConsultada = undefined;
  paginasDaConta = 0;
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

  it('ledger depois do maxTime fechado e a tx não achada pelo hash → EXPIROU', async () => {
    const env = await envelope();
    agora = (env.maxTime + 60) * 1000;
    for (let s = ledgerDoTempo(env.maxTime - 150); s <= ledgerDoTempo(env.maxTime); s += 4) {
      colocarNoLedger(s, `terceiro-${s}`);
    }

    const r = await txExpirouNaRede(env.xdr);

    expect(r).toMatchObject({ status: 'EXPIROU', hash: env.hash, maxTime: env.maxTime });
    const ledgerAposPrazo = (r as { ledgerAposPrazo: number }).ledgerAposPrazo;
    expect(fechamento(ledgerAposPrazo)).toBeGreaterThan(env.maxTime);
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

});

describe('issueAsset decide o desfecho pela rede, não pelo relógio local (R1)', () => {
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

describe('primeira tentativa (sem sequenceDe)', () => {
  // A substituição NÃO recarrega a conta: ver "(2) mesma conta-fonte e sem loadAccount na substituição".
  it('source = issuer e sequence = a da conta do issuer + 1 (loadAccount)', async () => {
    const a = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    const ta = new Transaction(a.xdr, networkPassphrase);

    expect(ta.source).toBe(issuerKp.publicKey());
    expect(a.sequence).toBe('11'); // Account(issuer, '10') + 1
    expect(ta.sequence).toBe(a.sequence);
    expect(vi.mocked(horizon.loadAccount).mock.calls).toEqual([[issuerKp.publicKey()]]);
  });
});

describe('substituição com a MESMA sequence (decisão do Atlas; contratos/2026-11-10-substituicao-mesma-sequence.md)', () => {
  // Core falso: aplica a tx só se a sequence for a da conta + 1; senão tx_bad_seq.
  let seqConta: bigint;
  let aplicadas: string[];
  let responderTimeoutAoAplicar: boolean;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(agora);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function ligarCoreFalso() {
    seqConta = BigInt(10); // Account(issuer, '10') do loadAccount falso
    aplicadas = [];
    responderTimeoutAoAplicar = true;
    // A conta reflete o core: depois que a antiga entra, loadAccount já vê a sequence nova.
    vi.mocked(horizon.loadAccount).mockImplementation(
      async () =>
        Object.assign(new Account(issuerKp.publicKey(), seqConta.toString()), {
          balances: [{ asset_type: 'native', balance: '100.0000000' }],
        }) as never,
    );
    vi.spyOn(horizon, 'submitTransaction').mockImplementation(async (tx) => {
      const t = tx as Transaction;
      const hash = t.hash().toString('hex');
      if (aplicadas.includes(hash)) throw erro400({ transaction: 'tx_bad_seq' });
      if (BigInt(t.sequence) !== seqConta + BigInt(1)) throw erro400({ transaction: 'tx_bad_seq' });
      seqConta += BigInt(1);
      aplicadas.push(hash);
      if (responderTimeoutAoAplicar) throw erro504(); // entrou, mas a resposta se perdeu
      return { hash, successful: true } as never;
    });
  }

  async function tentativaExpiradaQueEntrou() {
    ligarCoreFalso();
    const antiga = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    expect(await submitEnvelope(antiga.xdr)).toMatchObject({ status: 'AMBIGUOUS' });
    // Horizon atrasado: 404 por hash e nenhum rastro nos ledgers; a rede passou do maxTime.
    agora = (antiga.maxTime + 60) * 1000;
    vi.setSystemTime(agora); // a substituição é montada depois do prazo
    return antiga;
  }

  it('(1) antiga entrou + Horizon 404 por hash → a substituição volta tx_bad_seq e nada é emitido duas vezes', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    const nova = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    expect(nova.sequence).toBe(antiga.sequence);
    expect(nova.hash).not.toBe(antiga.hash);

    const err = await submitEnvelope(nova.xdr, { substitui: antiga.xdr }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EmissaoError);
    expect((err as EmissaoError).code).toBe('EMISSAO_SEQUENCIA_CONSUMIDA');
    expect((err as EmissaoError).hash).toBe(antiga.hash);
    expect(aplicadas).toEqual([antiga.hash]); // uma emissão só
  });

  it('tx_bad_seq na substituição e a antiga aparece pelo hash → SUCCESS da antiga, sem emitir de novo', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    const nova = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    lookup.mockImplementation(async (hash: string) => {
      if (hash === antiga.hash) return registro(hash);
      throw erro404();
    });

    expect(nova.hash).not.toBe(antiga.hash);
    expect(await submitEnvelope(nova.xdr, { substitui: antiga.xdr })).toMatchObject({
      status: 'SUCCESS',
      hash: antiga.hash,
    });
    expect(aplicadas).toEqual([antiga.hash]);
  });

  it('(3) antiga aparece com falha → EMISSAO_SEQUENCIA_CONSUMIDA (nunca uma terceira tx)', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    const nova = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    lookup.mockImplementation(async (hash: string) => {
      if (hash === antiga.hash) return registro(hash, false);
      throw erro404();
    });
    const montagens = vi.mocked(signer.sign).mock.calls.length;

    const err = await submitEnvelope(nova.xdr, { substitui: antiga.xdr }).catch((e: unknown) => e);
    expect((err as EmissaoError).code).toBe('EMISSAO_SEQUENCIA_CONSUMIDA');
    expect(vi.mocked(signer.sign).mock.calls.length).toBe(montagens); // nada novo assinado
  });

  it('antiga não entrou → a substituição (mesma sequence) entra uma vez', async () => {
    ligarCoreFalso();
    vi.mocked(horizon.submitTransaction).mockRejectedValueOnce(erro504()); // não aplicou
    const antiga = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    await submitEnvelope(antiga.xdr);
    agora = (antiga.maxTime + 60) * 1000;
    vi.setSystemTime(agora);
    responderTimeoutAoAplicar = false;

    const nova = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    expect(await submitEnvelope(nova.xdr, { substitui: antiga.xdr })).toMatchObject({
      status: 'SUCCESS',
      hash: nova.hash,
    });
    expect(aplicadas).toEqual([nova.hash]);
  });

  it('(2) mesma conta-fonte e sem loadAccount na substituição', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    const loads = vi.mocked(horizon.loadAccount).mock.calls.length;

    const nova = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    const t = new Transaction(nova.xdr, networkPassphrase);

    expect(t.source).toBe(issuerKp.publicKey());
    expect(t.sequence).toBe(new Transaction(antiga.xdr, networkPassphrase).sequence);
    expect(vi.mocked(horizon.loadAccount).mock.calls.length).toBe(loads);
  });

  it('recusa substituir (ISSUE_SUBSTITUICAO_INVALIDA) antes de assinar: XDR inválido, outra fonte, outro memo, outra emissão', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    const outroKp = Keypair.random();
    const outroSigner: StellarSigner = {
      publicKey: () => outroKp.publicKey(),
      sign: vi.fn((tx: Transaction) => tx.sign(outroKp)),
      signatureBase64: () => '',
    };
    const assinadas = vi.mocked(signer.sign).mock.calls.length;
    const casos: Array<() => Promise<unknown>> = [
      () => buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO, sequenceDe: 'lixo' }),
      () => buildIssueAssetTx(outroSigner, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO, sequenceDe: antiga.xdr }),
      () => buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: Buffer.alloc(32, 1), sequenceDe: antiga.xdr }),
      () => buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { sequenceDe: antiga.xdr }),
      () => buildIssueAssetTx(signer, DESTINO, '399.0000000', 'PLINARF', { memoHash: MEMO, sequenceDe: antiga.xdr }),
      () => buildIssueAssetTx(signer, Keypair.random().publicKey(), '400.0000000', 'PLINARF', { memoHash: MEMO, sequenceDe: antiga.xdr }),
    ];
    for (const caso of casos) {
      const err = await caso().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IssueAssetInputError);
      expect((err as IssueAssetInputError).code).toBe('ISSUE_SUBSTITUICAO_INVALIDA');
    }
    expect(vi.mocked(signer.sign).mock.calls.length).toBe(assinadas);
    expect(outroSigner.sign).not.toHaveBeenCalled();
  });

  it('condição extra do Argus: antiga ainda EM_ABERTO ou ENTROU → não monta a substituição', async () => {
    ligarCoreFalso();
    const antiga = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    agora = (antiga.maxTime + 3_600) * 1000;
    ultimoFixo = ledgerDoTempo(antiga.maxTime); // rede não fechou ledger depois do prazo
    const emAberto = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    }).catch((e: unknown) => e);
    expect((emAberto as IssueAssetInputError).code).toBe('ISSUE_SUBSTITUICAO_INVALIDA');

    ultimoFixo = null;
    lookup.mockImplementation(async (hash: string) => registro(hash));
    const entrou = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    }).catch((e: unknown) => e);
    expect((entrou as IssueAssetInputError).code).toBe('ISSUE_SUBSTITUICAO_INVALIDA');
  });

  it('issueAsset com sequenceDe: antiga já emitiu → devolve a antiga e não emite de novo', async () => {
    const antiga = await tentativaExpiradaQueEntrou();
    lookup.mockImplementation(async (hash: string) => {
      if (hash === antiga.hash && aplicadas.length > 0 && vi.mocked(horizon.submitTransaction).mock.calls.length > 1) {
        return registro(hash);
      }
      throw erro404();
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
      sequenceDe: antiga.xdr,
    });
    expect(res.hash).toBe(antiga.hash);
    expect(aplicadas).toEqual([antiga.hash]);
  });
});

describe('quemConsumiuSequence — prova positiva de quem consumiu a sequence (Argus/Atlas 12:38)', () => {
  function txDaConta(
    hash: string,
    seq: string,
    successful = true,
    source = issuerKp.publicKey(),
    memo?: Buffer,
  ) {
    return {
      ...registro(hash, successful),
      ledger_attr: 777,
      paging_token: `pt-${hash}`,
      source_account: source,
      source_account_sequence: seq,
      ...(memo ? { memo_type: 'hash', memo: memo.toString('base64') } : { memo_type: 'none' }),
    };
  }

  async function tentativas() {
    const antiga = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    // substituição com a mesma sequence (montada à mão: a regra de expiração não é o foco aqui)
    const t = new Transaction(antiga.xdr, networkPassphrase);
    const conta = new Account(issuerKp.publicKey(), (BigInt(t.sequence) - BigInt(1)).toString());
    const nova = new TransactionBuilder(conta, { fee: '100', networkPassphrase })
      .addOperation(Operation.payment(t.operations[0] as Operation.Payment))
      .addMemo(t.memo)
      .setTimeout(300)
      .build();
    nova.sign(issuerKp);
    return { antiga, novaXdr: nova.toXDR(), novaHash: nova.hash().toString('hex'), seq: t.sequence };
  }

  it('a antiga consumiu S → ANTIGA_ENTROU, mesmo com 404 por hash', async () => {
    const { antiga, novaXdr, seq } = await tentativas();
    txsDaConta = [txDaConta('depois', String(BigInt(seq) + BigInt(1))), txDaConta(antiga.hash, seq), txDaConta('antes', String(BigInt(seq) - BigInt(1)))];

    expect(await quemConsumiuSequence([antiga.xdr, novaXdr])).toEqual({
      status: 'ANTIGA_ENTROU',
      hash: antiga.hash,
      successful: true,
      ledger: 777,
    });
    expect(contaConsultada).toBe(issuerKp.publicKey());
  });

  it('a substituição consumiu S → ANTIGA_ENTROU com o hash dela', async () => {
    const { antiga, novaXdr, novaHash, seq } = await tentativas();
    txsDaConta = [txDaConta(novaHash, seq)];
    expect(await quemConsumiuSequence([antiga.xdr, novaXdr])).toMatchObject({ status: 'ANTIGA_ENTROU', hash: novaHash });
  });

  it('a nossa entrou com falha → ANTIGA_ENTROU com successful=false (nada emitido)', async () => {
    const { antiga, seq } = await tentativas();
    txsDaConta = [txDaConta(antiga.hash, seq, false)];
    expect(await quemConsumiuSequence([antiga.xdr])).toMatchObject({ status: 'ANTIGA_ENTROU', successful: false });
  });

  it('outra tx do issuer consumiu S → OUTRA_TX', async () => {
    const { antiga, novaXdr, seq } = await tentativas();
    txsDaConta = [txDaConta('outra-do-issuer', seq)];
    expect(await quemConsumiuSequence([antiga.xdr, novaXdr])).toEqual({ status: 'OUTRA_TX', hash: 'outra-do-issuer' });
  });

  it('S não aparece (instância atrasada; 404 do hash não é prova) → INDETERMINADO, nunca OUTRA_TX', async () => {
    const { antiga, novaXdr, seq } = await tentativas();
    txsDaConta = [txDaConta('anterior', String(BigInt(seq) - BigInt(1)))];
    expect(await quemConsumiuSequence([antiga.xdr, novaXdr])).toMatchObject({ status: 'INDETERMINADO' });

    txsDaConta = [];
    expect(await quemConsumiuSequence([antiga.xdr])).toMatchObject({ status: 'INDETERMINADO' });
  });

  it('tx de OUTRA conta com a mesma sequence não conta', async () => {
    const { antiga, seq } = await tentativas();
    txsDaConta = [txDaConta('de-outra-conta', seq, true, Keypair.random().publicKey())];
    expect(await quemConsumiuSequence([antiga.xdr])).toMatchObject({ status: 'INDETERMINADO' });
  });

  it('tentativas com sequences ou fontes diferentes → lança, sem consultar', async () => {
    const a = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    vi.mocked(horizon.loadAccount).mockImplementationOnce(
      async () => Object.assign(new Account(issuerKp.publicKey(), '20'), { balances: [] }) as never,
    );
    const b = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    await expect(quemConsumiuSequence([a.xdr, b.xdr])).rejects.toThrow();
    await expect(quemConsumiuSequence([])).rejects.toThrow();
    expect(contaConsultada).toBeUndefined();
  });

  it('erro do Horizon propaga', async () => {
    const { antiga } = await tentativas();
    vi.mocked(horizon.transactions).mockImplementationOnce(
      () =>
        ({
          forAccount: () => ({
            order: () => ({ includeFailed: () => ({ limit: () => ({ call: async () => { throw new Error('horizon 503'); } }) }) }),
          }),
        }) as never,
    );
    await expect(quemConsumiuSequence([antiga.xdr])).rejects.toThrow('horizon 503');
  });
});

describe('quemConsumiuSequence — ressalvas do Argus (Q1, Q4)', () => {
  function txDaConta(hash: string, seq: string, memo?: Buffer, source = issuerKp.publicKey()) {
    return {
      ...registro(hash),
      ledger_attr: 888,
      paging_token: `pt-${hash}`,
      source_account: source,
      source_account_sequence: seq,
      ...(memo ? { memo_type: 'hash', memo: memo.toString('base64') } : { memo_type: 'none' }),
    };
  }
  const mais = (seq: string, n: number) => String(BigInt(seq) + BigInt(n));

  async function substituicaoSemOXdrDaAntiga() {
    const antiga = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });
    const seq = new Transaction(antiga.xdr, networkPassphrase).sequence;
    return { antigaHash: antiga.hash, r1Xdr: antiga.xdr, seq };
  }

  it('Q1: A entrou, a lista de tentativas só tem R1 → ANTIGA_ENTROU pelo memo da emissão, nunca OUTRA_TX', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    txsDaConta = [txDaConta('hash-de-A', seq, MEMO)];

    expect(await quemConsumiuSequence([r1Xdr])).toEqual({
      status: 'ANTIGA_ENTROU',
      hash: 'hash-de-A',
      successful: true,
      ledger: 888,
    });
  });

  it('Q1: hash do histórico (hashesConhecidos) também prova que foi nossa, mesmo sem memo', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    txsDaConta = [txDaConta('hash-de-A', seq)];

    expect(await quemConsumiuSequence([r1Xdr], { hashesConhecidos: ['hash-de-A'] })).toMatchObject({
      status: 'ANTIGA_ENTROU',
      hash: 'hash-de-A',
    });
  });

  it('Q1: memo diferente e hash desconhecido → OUTRA_TX', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    txsDaConta = [txDaConta('de-outra-emissao', seq, Buffer.alloc(32, 7))];

    expect(await quemConsumiuSequence([r1Xdr], { hashesConhecidos: ['outro'] })).toEqual({
      status: 'OUTRA_TX',
      hash: 'de-outra-emissao',
    });
  });

  it('Q4: S na 2ª página → acha paginando', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    const acima = Array.from({ length: 200 }, (_, i) => txDaConta(`acima-${i}`, mais(seq, 200 - i)));
    txsDaConta = [...acima, txDaConta('consumidora', seq), txDaConta('abaixo', mais(seq, -1))];

    expect(await quemConsumiuSequence([r1Xdr])).toEqual({ status: 'OUTRA_TX', hash: 'consumidora' });
    expect(paginasDaConta).toBe(2);
  });

  it('Q4: passou abaixo de S sem achar → INDETERMINADO, sem ler mais páginas', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    txsDaConta = [txDaConta('acima', mais(seq, 1)), txDaConta('abaixo', mais(seq, -1)), txDaConta('bem-abaixo', mais(seq, -2))];

    expect(await quemConsumiuSequence([r1Xdr])).toMatchObject({ status: 'INDETERMINADO' });
    expect(paginasDaConta).toBe(1);
  });

  it('Q4: teto de 10 páginas → INDETERMINADO', async () => {
    const { r1Xdr, seq } = await substituicaoSemOXdrDaAntiga();
    txsDaConta = Array.from({ length: 2_400 }, (_, i) => txDaConta(`acima-${i}`, mais(seq, 2_400 - i)));

    expect(await quemConsumiuSequence([r1Xdr])).toMatchObject({ status: 'INDETERMINADO' });
    expect(paginasDaConta).toBe(10);
  });
});
