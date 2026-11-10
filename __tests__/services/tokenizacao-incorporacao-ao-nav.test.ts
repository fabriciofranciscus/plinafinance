import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma, StatusCota } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';

type Row = Record<string, any>;

// Estado em memória com semântica de transação: snapshot + rollback em exceção,
// e exclusão mútua entre transações (emula o pg_advisory_xact_lock).
const st = vi.hoisted(() => ({
  cfg: { network: 'TESTNET' },
  cotas: new Map<string, Row>(),
  audits: [] as Row[],
  movs: [] as Row[],
  /** Tentativas de emissão: FORA do rollback (commit próprio, antes do submit). */
  tentativas: new Map<string, Row>(),
  /** Txs "no ledger": hash → { successful, amount, memoHex }. */
  chain: new Map<string, { successful: boolean; amount: string; memoHex: string }>(),
  /** Txs construídas (pelo build) e já enviadas ao menos uma vez. */
  built: [] as Array<{ hash: string; xdr: string; amount: string; memoHex: string; maxTime: number }>,
  submits: [] as string[],
  /** Resultado de cada chamada de submitEnvelope, em ordem (padrão SUCCESS). */
  submitScript: [] as Array<'SUCCESS' | 'FAILED' | 'AMBIGUOUS' | 'AMBIGUOUS_LANDS'>,
  failAuditOnce: false,
  /** Respostas forçadas de buscarTxPorHash, em ordem (esgotadas, volta ao ledger simulado). */
  hashScript: [] as Array<{ found: boolean; successful?: boolean; ledgerCloseTime?: string }>,
  failBuscarHash: null as Error | null,
  failBuscarMemo: null as Error | null,
  calls: [] as string[],
  fetchSupplyDasClasses: vi.fn(),
  eventoFind: vi.fn(),
  tail: Promise.resolve() as Promise<unknown>,
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => st.cfg.network, enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  buildIssueAssetTx: vi.fn(async (_s: unknown, _d: string, amount: string, _code: string, opts?: { memoHash?: Buffer }) => {
    const n = st.built.length + 1;
    const hash = `hash${n}`;
    const maxTime = Math.floor(Date.now() / 1000) + 120;
    const t = { hash, xdr: `XDR${n}`, amount, memoHex: opts?.memoHash?.toString('hex') ?? '', maxTime };
    st.built.push(t);
    st.calls.push('build');
    return { xdr: t.xdr, hash, maxTime };
  }),
  submitEnvelope: vi.fn(async (xdr: string) => {
    st.calls.push('submit');
    st.submits.push(xdr);
    await Promise.resolve();
    const t = st.built.find((b) => b.xdr === xdr)!;
    const outcome = st.submitScript.shift() ?? 'SUCCESS';
    if (outcome === 'SUCCESS') {
      st.chain.set(t.hash, { successful: true, amount: t.amount, memoHex: t.memoHex });
      return { status: 'SUCCESS', hash: t.hash };
    }
    if (outcome === 'FAILED') return { status: 'FAILED', hash: t.hash, resultCodes: { transaction: 'tx_failed' } };
    if (outcome === 'AMBIGUOUS_LANDS') st.chain.set(t.hash, { successful: true, amount: t.amount, memoHex: t.memoHex });
    return { status: 'AMBIGUOUS', hash: t.hash, reason: 'timeout' };
  }),
  buscarTxPorHash: vi.fn(async (hash: string) => {
    st.calls.push('buscarHash');
    if (st.failBuscarHash) throw st.failBuscarHash;
    const forcada = st.hashScript.shift();
    if (forcada) return forcada;
    const t = st.chain.get(hash);
    return t ? { found: true, successful: t.successful, ledgerCloseTime: 'x' } : { found: false };
  }),
  buscarEmissaoPorMemo: vi.fn(async ({ memoHash }: { memoHash: Buffer }) => {
    st.calls.push('buscarMemo');
    if (st.failBuscarMemo) throw st.failBuscarMemo;
    const hex = memoHash.toString('hex');
    for (const [hash, t] of st.chain) if (t.memoHex === hex && t.successful) return { txHash: hash, amount: t.amount };
    return null;
  }),
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({}) }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.fetchSupplyDasClasses }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));
vi.mock('@/lib/db', () => {
  const cota = {
    findUnique: async ({ where }: { where: { id: string } }) => st.cotas.get(where.id) ?? null,
    findFirst: async ({ where }: { where: { hashValidacao?: string } }) =>
      [...st.cotas.values()].find((c) => c.hashValidacao === where.hashValidacao) ?? null,
    findMany: async () => [...st.cotas.values()].filter((c) => c.status === 'DISPONIVEL' || c.status === 'RESERVADA'),
    create: async ({ data }: { data: Row }) => {
      st.calls.push('cota.create');
      if (st.cotas.has(data.id)) throw new Error('unique');
      st.cotas.set(data.id, { ...data });
      return data;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const c = st.cotas.get(where.id);
      if (c) st.cotas.set(where.id, { ...c, ...data });
      return c;
    },
  };
  const eventoAudit = {
    findFirst: st.eventoFind,
    create: async ({ data }: { data: Row }) => {
      st.calls.push('audit.create');
      if (st.failAuditOnce) { st.failAuditOnce = false; throw new Error('db caiu'); }
      st.audits.push(data);
      return data;
    },
  };
  const movimentoFundo = {
    aggregate: async () => ({ _sum: { deltaCaixa: null } }),
    createMany: async ({ data }: { data: Row[] }) => {
      st.calls.push('mov.create');
      let count = 0;
      for (const d of data) {
        if (st.movs.some((x) => x.chave === d.chave)) continue;
        st.movs.push(d);
        count++;
      }
      return { count };
    },
  };
  const tentativaEmissao = {
    findUnique: async ({ where }: { where: { memoHash: string } }) => st.tentativas.get(where.memoHash) ?? null,
    upsert: async ({ where, create, update }: { where: { memoHash: string }; create: Row; update: Row }) => {
      st.calls.push('tentativa.upsert');
      const atual = st.tentativas.get(where.memoHash);
      st.tentativas.set(where.memoHash, atual ? { ...atual, ...update } : { ...create });
      return st.tentativas.get(where.memoHash);
    },
    update: async ({ where, data }: { where: { memoHash: string }; data: Row }) => {
      const atual = st.tentativas.get(where.memoHash)!;
      st.tentativas.set(where.memoHash, { ...atual, ...data });
      return st.tentativas.get(where.memoHash);
    },
    // lerSupplyDoNav: há emissão em voo (PENDENTE/CONFIRMADA sem domínio)?
    findFirst: async ({ where }: { where: { status: { in: string[] }; aplicadaEm: null } }) =>
      [...st.tentativas.values()].find((t) => where.status.in.includes(t.status as string) && !t.aplicadaEm) ?? null,
    // marca APLICADA na mesma transação da Cota
    updateMany: async ({ where, data }: { where: { memoHash: string; aplicadaEm: null }; data: Row }) => {
      const atual = st.tentativas.get(where.memoHash);
      if (!atual || atual.aplicadaEm) return { count: 0 };
      st.calls.push('tentativa.aplicada');
      st.tentativas.set(where.memoHash, { ...atual, ...data });
      return { count: 1 };
    },
  };
  const tx = { cota, eventoAudit, movimentoFundo, tentativaEmissao, $queryRaw: vi.fn(async () => { st.calls.push('lock'); return []; }) };
  const run = async (fn: (t: typeof tx) => Promise<unknown>) => {
    const snap = { cotas: new Map([...st.cotas].map(([k, v]) => [k, { ...v }])), audits: [...st.audits], movs: [...st.movs] };
    try {
      return await fn(tx);
    } catch (e) {
      st.cotas = snap.cotas; st.audits = snap.audits; st.movs = snap.movs; // rollback
      throw e;
    }
  };
  return {
    db: {
      eventoAudit: { findFirst: st.eventoFind, create: eventoAudit.create },
      cota,
      movimentoFundo,
      tentativaEmissao,
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => {
        const p = st.tail.then(() => run(fn));
        st.tail = p.catch(() => undefined);
        return p;
      },
    },
  };
});

import {
  FOLGA_MAXTIME_MS,
  IncorporacaoBloqueadaError,
  IncorporacaoEmissaoError,
  atualizarStatusCota,
  incorporarCota,
  memoHashDaIncorporacao,
} from '@/lib/services/tokenizacao';
import { NavIndisponivelError, lerSupplyDoNav, resetNavSupplyCache } from '@/lib/services/nav-supply';
import { navPorTokenAsDecimal } from '@/lib/services/pool';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (c: string) => ({ circulante: D(c), tesouraria: D('0') }) as never;
const HASH = 'a'.repeat(64);
const POSICAO = Keypair.random().publicKey();

function evidencias(anuencia: 'CONFIRMADA' | 'DECLARADA_PENDENTE' | null = 'DECLARADA_PENDENTE', laudo = true) {
  st.eventoFind.mockImplementation(async ({ where }: { where: { acao: string } }) => {
    if (where.acao === 'COTA_VALIDADA') return laudo ? { stellarTxHash: 'txLaudo' } : null;
    if (where.acao === 'ANUENCIA_REGISTRADA') return anuencia ? { payloadJson: { hashValidacao: HASH, status: anuencia } } : null;
    return null;
  });
}

// cota nova de R$ 400 de custo: 500 × (1 − 0,20)
const base = {
  tipoBem: 'VEICULO' as never,
  administradora: 'X',
  valorCarta: '500',
  desagioAquisicao: '0.20',
  operador: 'admin',
  hashValidacao: HASH,
  cessaoId: 'ces_1',
};

const T0 = Date.parse('2026-11-10T12:00:00Z');
const avancar = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.STELLAR_ISSUER_SECRET = 'S-test';
  process.env.STELLAR_PLINA_POSITION_PUBLIC = POSICAO;
  st.cfg.network = 'TESTNET';
  st.cotas = new Map(); st.audits = []; st.movs = []; st.tentativas = new Map(); st.chain = new Map();
  st.built = []; st.submits = []; st.submitScript = []; st.calls = [];
  st.failAuditOnce = false; st.hashScript = []; st.failBuscarHash = null; st.failBuscarMemo = null; st.tail = Promise.resolve();
  resetNavSupplyCache();
  evidencias();
  st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Txs que de fato entraram no ledger (uma emissão = uma tx). */
const emissoes = () => st.chain.size;
const memoDe = (chave: string) => memoHashDaIncorporacao(chave).toString('hex');

describe('incorporarCota — aporte ao NAV', () => {
  it('1ª incorporação com supply zero: R$ 400 → 400 PLINARF, para a posição da Plina, com memo por cessão', async () => {
    const r = await incorporarCota(base);
    expect(r.tokensEmitidos).toBe(400);
    expect(st.built).toHaveLength(1);
    expect(st.built[0].amount).toBe('400.0000000');
    expect(st.built[0].memoHex).toBe(createHash('sha256').update('plina:incorporacao:ces_1').digest('hex'));
    expect(st.built[0].memoHex).toBe(memoDe('ces_1'));
  });

  it('NAV por token igual antes e depois do aporte (R$ 64.000 a NAV 1,041667 → ~61.440 tokens)', async () => {
    const existente = { id: 'x1', valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '250000', status: StatusCota.DISPONIVEL, hashValidacao: 'outro' };
    st.cotas.set('x1', existente);
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('240000'), subordinada: supply('0') });
    const navAntes = navPorTokenAsDecimal([existente as never], [{ valorRealizado: 0 }], { circulante: '240000', tesouraria: '0' });
    expect(navAntes.toFixed(6)).toBe('1.041667');

    const r = await incorporarCota({ ...base, valorCarta: '80000', desagioAquisicao: '0.20' }); // V = 64.000
    expect(Math.round(r.tokensEmitidos)).toBe(61440);
    const q = D(String(r.tokensEmitidos));
    const nova = { valorCarta: '80000', desagioAquisicao: '0.20', tokensEmitidos: q.toString(), status: StatusCota.DISPONIVEL };
    const navDepois = navPorTokenAsDecimal([existente as never, nova], [{ valorRealizado: 0 }], {
      circulante: D('240000').plus(q),
      tesouraria: '0',
    });
    expect(navDepois.toFixed(6)).toBe(navAntes.toFixed(6));
  });

  it('DB depois da chain: a tentativa é commitada ANTES do submit; domínio só depois', async () => {
    await incorporarCota({ ...base, pixValorBrl: '400.00', pixHash: 'pixTx' });
    const iSubmit = st.calls.indexOf('submit');
    expect(iSubmit).toBeGreaterThan(-1);
    expect(st.calls.indexOf('tentativa.upsert')).toBeLessThan(iSubmit); // fora do domínio, antes do submit
    for (const w of ['cota.create', 'audit.create', 'mov.create']) {
      expect(st.calls.indexOf(w)).toBeGreaterThan(iSubmit);
    }
    expect(st.calls.indexOf('lock')).toBeLessThan(iSubmit); // lock não grava linha de domínio
    const cota = [...st.cotas.values()][0];
    expect(cota).toMatchObject({ status: 'DISPONIVEL', emissaoTxHash: 'hash1', hashValidacao: HASH, anuenciaStatus: 'DECLARADA_PENDENTE', cessaoId: 'ces_1' });
    expect(cota.id).toMatch(/^inc_[0-9a-f]{32}$/);
    expect(st.audits.map((a) => a.acao)).toEqual(['COTA_INCORPORADA', 'TOKEN_EMITIDO']);
    const mov = st.movs[0];
    expect(mov).toMatchObject({ tipo: 'APORTE_COTA', refHash: 'pixTx', hashValidacao: HASH, txHash: 'hash1', chave: `aporte-cota:${cota.id}` });
    expect(mov.deltaCaixa.toString()).toBe('0'); // nunca AQUISICAO: o fundo não pagou a cota
    expect(mov.deltaTokens.toFixed(7)).toBe('400.0000000');
    expect(mov.navPorToken.toFixed(8)).toBe('1.00000000');
  });

  it('a TentativaEmissao guarda o envelope, o hash, o maxTime e o preço (fora do domínio)', async () => {
    await incorporarCota(base);
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t).toMatchObject({ txHash: 'hash1', envelopeXdr: 'XDR1', status: 'CONFIRMADA' });
    expect(t.maxTime.getTime()).toBe(T0 + 120_000);
    expect(t.quantidade.toFixed(7)).toBe('400.0000000');
    expect(t.navPorToken.toFixed(8)).toBe('1.00000000');
    expect(t.valorBrl.toFixed(2)).toBe('400.00');
  });
});

describe('incorporarCota — erro definitivo da rede (FAILED)', () => {
  it('lança EMISSAO_FALHOU na hora, com os result codes; nada gravado no domínio; tentativa FALHOU', async () => {
    st.submitScript = ['FAILED'];
    const err = await incorporarCota(base).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoEmissaoError);
    expect(err.code).toBe('EMISSAO_FALHOU');
    expect(err.detalhes.resultCodes).toEqual({ transaction: 'tx_failed' });
    expect(err.message).not.toMatch(/Reexecutar é seguro/);
    expect(st.cotas.size).toBe(0);
    expect(st.audits).toHaveLength(0);
    expect(st.movs).toHaveLength(0);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('FALHOU');
  });

  it('FAILED libera nova tentativa NA HORA: tx nova, uma emissão, domínio gravado uma vez', async () => {
    st.submitScript = ['FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    const r = await incorporarCota(base);
    expect(st.built).toHaveLength(2);
    expect(r.txHash).toBe('hash2');
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(1);
    expect(st.movs).toHaveLength(1);
  });

  it('tx que entrou mas FALHOU on-chain não aplicou nada: libera tx nova', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: false, amount: '400.0000000', memoHex: memoDe('ces_1') });
    const r = await incorporarCota(base);
    expect(st.built).toHaveLength(2);
    expect(r.txHash).toBe('hash2');
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('CONFIRMADA');
  });
});

describe('incorporarCota — erro ambíguo (timeout/5xx/rede): o teste da Vera', () => {
  const estadoLimpo = () => {
    expect(st.cotas.size).toBe(0);
    expect(st.audits).toHaveLength(0);
    expect(st.movs).toHaveLength(0);
  };

  it('ambíguo → EMISSAO_EM_ANDAMENTO com o maxTime; NADA gravado no domínio; tentativa fica PENDENTE', async () => {
    st.submitScript = ['AMBIGUOUS'];
    const err = await incorporarCota(base).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoEmissaoError);
    expect(err.code).toBe('EMISSAO_EM_ANDAMENTO');
    expect(err.detalhes.maxTime.getTime()).toBe(T0 + 120_000);
    expect(err.message).toContain(new Date(T0 + 120_000).toISOString());
    expect(err.message).not.toMatch(/Reexecutar é seguro/);
    estadoLimpo();
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
  });

  it('a tx "entra" depois; nova chamada DENTRO dos 120 s NÃO emite tx nova: reenvia o MESMO XDR (ou recusa)', async () => {
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS']; // 1º envio e o reenvio seguem ambíguos
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(30_000);
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1); // nenhuma tx nova
    expect(st.submits).toEqual(['XDR1', 'XDR1']); // o MESMO envelope reenviado
    expect(emissoes()).toBe(0);
    estadoLimpo();
  });

  it('a tx entra durante a espera e a nova chamada a ACHA PELO HASH: grava o domínio uma vez, sem emitir de novo', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    // a tx entra no ledger depois do timeout
    st.chain.set('hash1', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    avancar(130_000); // depois dos 120 s
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(r.tokensEmitidos).toBe(400);
    expect(st.built).toHaveLength(1);
    expect(st.submits).toEqual(['XDR1']); // nenhum reenvio: achou pelo hash
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(1);
    expect(st.movs).toHaveLength(1);
    expect(st.audits[0].payloadJson.recuperadaPorMemo).toBe(true);
    expect(st.movs[0].navPorToken.toFixed(8)).toBe('1.00000000'); // preço guardado na tentativa
    // e uma terceira chamada é idempotente
    await incorporarCota(base);
    expect(st.cotas.size).toBe(1);
    expect(emissoes()).toBe(1);
  });

  it('o reenvio do mesmo XDR que "pega" (SUCCESS) grava o domínio, sem tx nova', async () => {
    st.submitScript = ['AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(20_000);
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.built).toHaveLength(1);
    expect(st.submits).toEqual(['XDR1', 'XDR1']);
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(1);
  });

  it('se a tx NUNCA entrou: só DEPOIS do maxTime (+10 s) sai tx nova, e a emissão acontece uma vez', async () => {
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(120_000 + FOLGA_MAXTIME_MS - 1_000); // ainda dentro de maxTime + 10 s
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1);
    avancar(2_000); // agora passou de maxTime + 10 s
    const r = await incorporarCota(base);
    expect(st.built).toHaveLength(2); // tx nova só agora
    expect(r.txHash).toBe('hash2');
    expect(emissoes()).toBe(1); // a antiga nunca entrou; a nova entrou uma vez
    expect(st.cotas.size).toBe(1);
    expect(st.movs).toHaveLength(1);
    expect(st.tentativas.get(memoDe('ces_1'))).toMatchObject({ txHash: 'hash2', status: 'CONFIRMADA' });
  });

  it('reenvio com FAILED (ex.: tx_bad_seq) mas a tx JÁ entrou: confere pelo hash e confirma, sem afirmar falha', async () => {
    st.submitScript = ['AMBIGUOUS', 'FAILED'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(10_000);
    // a busca inicial não acha; o reenvio dá FAILED; a releitura acha (a tx entrou entre uma e outra)
    st.hashScript = [{ found: false }, { found: true, successful: true, ledgerCloseTime: 'x' }];
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.built).toHaveLength(1);
    expect(st.cotas.size).toBe(1);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('CONFIRMADA');
  });

  it('reenvio com FAILED e a tx não está no ledger → EMISSAO_FALHOU e libera tx nova', async () => {
    st.submitScript = ['AMBIGUOUS', 'FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(10_000);
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('FALHOU');
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash2');
    expect(emissoes()).toBe(1);
  });

  it('falha ao consultar o Horizon por hash é fail-closed: não emite tx nova, não grava', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.failBuscarHash = new Error('horizon down');
    avancar(200_000);
    await expect(incorporarCota(base)).rejects.toThrow('horizon down');
    expect(st.built).toHaveLength(1);
    estadoLimpo();
  });
});

describe('incorporarCota — crash, concorrência e idempotência', () => {
  it('crash entre submit e commit: a nova chamada acha a tx pelo hash e grava, SEM reemitir', async () => {
    st.failAuditOnce = true; // chain ok (SUCCESS), banco cai antes do commit do domínio
    await expect(incorporarCota(base)).rejects.toThrow('db caiu');
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(0); // rollback: nenhuma linha de domínio sem a tx correspondente

    const r = await incorporarCota(base);
    expect(emissoes()).toBe(1);
    expect(st.built).toHaveLength(1);
    expect(r.txHash).toBe('hash1');
    expect(r.tokensEmitidos).toBe(400);
    expect(st.cotas.size).toBe(1);
    expect(st.audits[0].payloadJson.recuperadaPorMemo).toBe(true);
    expect(st.movs).toHaveLength(1);
  });

  it('a recuperação usa a quantidade EMITIDA (guardada na tentativa), mesmo com o NAV do ledger já alterado', async () => {
    st.failAuditOnce = true;
    await expect(incorporarCota(base)).rejects.toThrow('db caiu');
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('400'), subordinada: supply('0') });
    const r = await incorporarCota(base);
    expect(r.tokensEmitidos).toBe(400);
    expect(emissoes()).toBe(1);
  });

  it('duas chamadas concorrentes: uma tx só, as duas devolvem a mesma cota', async () => {
    const [a, b] = await Promise.all([incorporarCota(base), incorporarCota(base)]);
    expect(st.built).toHaveLength(1);
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(1);
    expect(st.movs).toHaveLength(1);
    expect(a.cotaId).toBe(b.cotaId);
    expect(a.txHash).toBe(b.txHash);
  });

  it('duas chamadas concorrentes com envio ambíguo: ainda uma tx só (a 2ª reenvia o mesmo XDR)', async () => {
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS'];
    const rs = await Promise.allSettled([incorporarCota(base), incorporarCota(base)]);
    expect(rs.every((r) => r.status === 'rejected' && (r.reason as IncorporacaoEmissaoError).code === 'EMISSAO_EM_ANDAMENTO')).toBe(true);
    expect(st.built).toHaveLength(1);
    expect(new Set(st.submits)).toEqual(new Set(['XDR1']));
  });

  it('reexecução depois de concluída é idempotente (não emite, não duplica)', async () => {
    const a = await incorporarCota(base);
    const b = await incorporarCota(base);
    expect(b).toMatchObject({ cotaId: a.cotaId, txHash: a.txHash });
    expect(emissoes()).toBe(1);
    expect(st.movs).toHaveLength(1);
  });

  it('rede de segurança: emissão anterior à tabela (sem tentativa) é achada pelo memo e não reemite', async () => {
    st.chain.set('hashLegado', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hashLegado');
    expect(st.built).toHaveLength(0);
    expect(st.audits[0].payloadJson.recuperadaPorMemo).toBe(true);
    expect(st.movs[0].navPorToken.toFixed(8)).toBe('1.00000000'); // V ÷ q reconstruído
  });

  it('falha de leitura da busca por memo é fail-closed: não emite às cegas', async () => {
    st.failBuscarMemo = new Error('horizon down');
    await expect(incorporarCota(base)).rejects.toThrow('horizon down');
    expect(st.built).toHaveLength(0);
    expect(st.cotas.size).toBe(0);
  });

  it('sem cessão a chave da emissão é o laudo', async () => {
    const { cessaoId: _omit, ...semCessao } = base;
    void _omit;
    await incorporarCota(semCessao);
    expect(st.built[0].memoHex).toBe(memoHashDaIncorporacao(HASH).toString('hex'));
  });
});

describe('incorporarCota — emissão recusada (nada vai à chain)', () => {
  const recusa = async (input: Parameters<typeof incorporarCota>[0], code: string) => {
    const err = await incorporarCota(input).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoBloqueadaError);
    expect(err.code).toBe(code);
    expect(emissoes()).toBe(0);
    expect(st.built).toHaveLength(0);
    expect(st.cotas.size).toBe(0);
  };

  it('sem hashValidacao', () => recusa({ ...base, hashValidacao: undefined }, 'LAUDO_AUSENTE'));
  it('hash sem laudo registrado', async () => { evidencias('CONFIRMADA', false); await recusa(base, 'LAUDO_AUSENTE'); });
  it('laudo sem anuência', async () => { evidencias(null); await recusa(base, 'ANUENCIA_AUSENTE'); });
  it('declarada pendente em mainnet', async () => { st.cfg.network = 'PUBLIC'; await recusa(base, 'ANUENCIA_PENDENTE_EM_MAINNET'); });
  it('laudo já usado por OUTRA cota', async () => {
    st.cotas.set('outra', { id: 'outra', hashValidacao: HASH, status: 'DISPONIVEL' });
    await incorporarCota(base).then(() => { throw new Error('deveria recusar'); }, (e) => {
      expect(e).toBeInstanceOf(IncorporacaoBloqueadaError);
      expect(e.code).toBe('LAUDO_JA_USADO');
    });
    expect(emissoes()).toBe(0);
    expect(st.cotas.size).toBe(1);
  });
  it('sem conta de posição da Plina', async () => { delete process.env.STELLAR_PLINA_POSITION_PUBLIC; await recusa(base, 'POSICAO_PLINA_AUSENTE'); });
  it('conta de posição inválida também é recusada', async () => { process.env.STELLAR_PLINA_POSITION_PUBLIC = 'nao-e-chave'; await recusa(base, 'POSICAO_PLINA_AUSENTE'); });

  it('a mensagem de recusa é fixa e não cita nome de env nem valor', async () => {
    process.env.STELLAR_PLINA_POSITION_PUBLIC = 'valor-secreto-invalido';
    const err = await incorporarCota(base).catch((e) => e);
    expect(err.code).toBe('POSICAO_PLINA_AUSENTE');
    expect(err.message).not.toMatch(/STELLAR_|PLINA_POSITION|valor-secreto/);
  });

  it('Pix diferente do custo', () => recusa({ ...base, pixValorBrl: '390.00' }, 'PIX_DIVERGE_DO_CUSTO'));
  it('custo não positivo', () => recusa({ ...base, desagioAquisicao: '1' }, 'CUSTO_INVALIDO'));

  it('declarada pendente em testnet é aceita e fica registrada na cota', async () => {
    await incorporarCota(base);
    expect([...st.cotas.values()][0].anuenciaStatus).toBe('DECLARADA_PENDENTE');
  });

  it('anuência CONFIRMADA em mainnet é aceita', async () => {
    st.cfg.network = 'PUBLIC';
    evidencias('CONFIRMADA');
    await incorporarCota(base);
    expect([...st.cotas.values()][0].anuenciaStatus).toBe('CONFIRMADA');
  });

  it('ledger fora → NavIndisponivelError, sem emitir nem gravar', async () => {
    st.fetchSupplyDasClasses.mockRejectedValue(new Error('x'));
    await expect(incorporarCota(base)).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(emissoes()).toBe(0);
    expect(st.cotas.size).toBe(0);
  });

  it('PLINARFB circulando (D3) → recusa', async () => {
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('0'), subordinada: supply('1') });
    await expect(incorporarCota(base)).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(emissoes()).toBe(0);
  });
});

describe('atualizarStatusCota', () => {
  it('não entra nem sai de EMISSAO_PENDENTE (em desuso) por aqui', async () => {
    st.cotas.set('c', { id: 'c', status: 'DISPONIVEL' });
    await expect(atualizarStatusCota({ cotaId: 'c', status: 'EMISSAO_PENDENTE' as never, operador: 'a' })).rejects.toThrow(/EMISSAO_PENDENTE/);
    st.cotas.set('c', { id: 'c', status: 'EMISSAO_PENDENTE' });
    await expect(atualizarStatusCota({ cotaId: 'c', status: 'DISPONIVEL' as never, operador: 'a' })).rejects.toThrow(/EMISSAO_PENDENTE/);
  });
  it('transições normais continuam', async () => {
    st.cotas.set('c', { id: 'c', status: 'DISPONIVEL' });
    await atualizarStatusCota({ cotaId: 'c', status: 'REVERTIDA' as never, operador: 'a' });
    expect(st.cotas.get('c')!.status).toBe('REVERTIDA');
  });
});

describe('incorporarCota — parecer da Consuelo (NAV em voo, valor divergente, histórico)', () => {
  it('ALTO: tentativa PENDENTE trava o NAV; ao gravar o domínio a tentativa fica aplicada e o NAV volta', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    // a tx pode estar na chain (+q no supply) sem o domínio: o NAV cairia — fica indisponível
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('400'), subordinada: supply('0') });
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });
    await expect(lerSupplyDoNav({ fresh: true })).rejects.toBeInstanceOf(NavIndisponivelError);

    st.chain.set('hash1', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    avancar(130_000);
    await incorporarCota(base);
    expect(st.tentativas.get(memoDe('ces_1'))!.aplicadaEm).toBeInstanceOf(Date);
    resetNavSupplyCache();
    await expect(lerSupplyDoNav()).resolves.toMatchObject({ senior: { circulante: expect.anything() } });
  });

  it('ALTO: CONFIRMADA sem domínio (banco caiu depois da chain) também trava o NAV até a recuperação', async () => {
    st.failAuditOnce = true;
    await expect(incorporarCota(base)).rejects.toThrow('db caiu');
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.status).toBe('CONFIRMADA');
    expect(t.aplicadaEm ?? null).toBeNull();
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });

    await incorporarCota(base); // recuperação: acha pelo hash e grava o domínio
    expect(st.cotas.size).toBe(1);
    resetNavSupplyCache();
    await expect(lerSupplyDoNav()).resolves.toBeDefined();
  });

  it('MÉDIO: valor de aporte diferente do guardado recusa antes de reenviar o XDR', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(30_000); // ainda dentro do maxTime: o caminho seria reenviar o MESMO XDR
    const err = await incorporarCota({ ...base, valorCarta: '600' }).catch((e) => e); // V = 480 ≠ 400
    expect(err).toBeInstanceOf(IncorporacaoBloqueadaError);
    expect(err.code).toBe('VALOR_DIVERGE_DA_TENTATIVA');
    expect(st.submits).toEqual(['XDR1']); // não reenviou
    expect(st.cotas.size).toBe(0);
  });

  it('MÉDIO: tx que já entrou com valor de aporte diferente → recusa, nada gravado no domínio', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    avancar(130_000);
    await expect(incorporarCota({ ...base, valorCarta: '600' })).rejects.toMatchObject({
      code: 'VALOR_DIVERGE_DA_TENTATIVA',
    });
    expect(st.cotas.size).toBe(0);
    expect(st.movs).toHaveLength(0);
    // com o valor original, a recuperação segue normalmente
    await expect(incorporarCota(base)).resolves.toMatchObject({ txHash: 'hash1' });
  });

  it('BAIXO: a tentativa anterior (FALHOU/EXPIRADA) vai para o histórico em vez de ser apagada', async () => {
    st.submitScript = ['FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    await incorporarCota(base);
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.txHash).toBe('hash2');
    expect(t.historico).toHaveLength(1);
    expect(t.historico[0]).toMatchObject({
      txHash: 'hash1',
      status: 'FALHOU',
      valorBrl: '400',
      quantidade: '400',
    });
    expect(typeof t.historico[0].substituidaEm).toBe('string');
  });
});
