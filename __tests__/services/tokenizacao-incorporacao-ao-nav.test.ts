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
  built: [] as Array<{ hash: string; xdr: string; amount: string; memoHex: string; maxTime: number; sequence: string; sequenceDe?: string }>,
  submits: [] as string[],
  /** `substitui` de cada submitEnvelope (undefined = envio normal). */
  substitui: [] as Array<string | undefined>,
  /** Erro forçado do buildIssueAssetTx de substituição (ex.: ISSUE_SUBSTITUICAO_INVALIDA). */
  buildErro: null as Error | null,
  /** Resposta forçada de quemConsumiuSequence (Error = Horizon fora). */
  consumo: null as null | Error | { status: string; hash?: string; successful?: boolean; ledger?: number; motivo?: string },
  consumoArgs: [] as string[][],
  consumoHashes: [] as Array<string[] | undefined>,
  /** Resultado de cada chamada de submitEnvelope, em ordem (padrão SUCCESS). */
  submitScript: [] as Array<'SUCCESS' | 'FAILED' | 'AMBIGUOUS' | 'AMBIGUOUS_LANDS' | 'SEQ_CONSUMIDA' | 'ANTERIOR_EMITIU' | 'ERRO_COMUM' | 'FAILED_TOO_LATE'>,
  failAuditOnce: false,
  /** Respostas forçadas de buscarTxPorHash, em ordem (esgotadas, volta ao ledger simulado). */
  hashScript: [] as Array<{ found: boolean; successful?: boolean; ledgerCloseTime?: string }>,
  /** Veredito forçado de txExpirouNaRede (padrão: ENTROU se está no ledger simulado, senão EXPIROU). */
  expiry: null as null | 'EM_ABERTO' | Error,
  failBuscarHash: null as Error | null,
  failBuscarMemo: null as Error | null,
  calls: [] as string[],
  fetchSupplyDasClasses: vi.fn(),
  eventoFind: vi.fn(),
  tail: Promise.resolve() as Promise<unknown>,
  /** E1-p: chamadas da âncora do registro (q, nav, desde) e falha forçada. */
  ancoras: [] as Array<{ tokensEmitir: string; navPorTokenUsado: string; desde: Date }>,
  ancoraFalha: null as Error | null,
}));
vi.mock('@/lib/services/registro-incorporacao', () => {
  class RegistroIncorporacaoError extends Error { readonly code = 'ANCORA_INCORPORACAO_FALHOU'; }
  return {
    RegistroIncorporacaoError,
    ancorarRegistroIncorporacao: vi.fn(async (e: { tokensEmitir: { toFixed: (n: number) => string }; navPorTokenUsado: { toFixed: (n: number) => string }; desde: Date; cotaId: string }) => {
      st.calls.push('ancora');
      if (st.ancoraFalha) throw new RegistroIncorporacaoError('forçada');
      const q = e.tokensEmitir.toFixed(7);
      const nav = e.navPorTokenUsado.toFixed(8);
      st.ancoras.push({ tokensEmitir: q, navPorTokenUsado: nav, desde: e.desde });
      const registro = { tipo: 'COTA_INCORPORADA', cotaId: e.cotaId, tokensEmitir: q, navPorTokenUsado: nav };
      const sha256Hex = createHash('sha256').update(JSON.stringify(registro)).digest('hex');
      return { registro, sha256Hex, ancoraTxHash: `ancora-${sha256Hex.slice(0, 8)}` };
    }),
  };
});

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => st.cfg.network, enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  buildIssueAssetTx: vi.fn(async (_s: unknown, _d: string, amount: string, _code: string, opts?: { memoHash?: Buffer; sequenceDe?: string }) => {
    if (opts?.sequenceDe && st.buildErro) { const e = st.buildErro; st.buildErro = null; throw e; }
    const n = st.built.length + 1;
    const hash = `hash${n}`;
    const maxTime = Math.floor(Date.now() / 1000) + 120;
    // Substituição (sequenceDe) reaproveita a MESMA sequence; tx normal pega uma sequence nova.
    const anterior = opts?.sequenceDe ? st.built.find((b) => b.xdr === opts.sequenceDe) : undefined;
    const sequence = anterior ? anterior.sequence : `seq${n}`;
    const t = { hash, xdr: `XDR${n}`, amount, memoHex: opts?.memoHash?.toString('hex') ?? '', maxTime, sequence, sequenceDe: opts?.sequenceDe };
    st.built.push(t);
    st.calls.push('build');
    return { xdr: t.xdr, hash, maxTime, sequence };
  }),
  submitEnvelope: vi.fn(async (xdr: string, opts?: { substitui?: string }) => {
    st.calls.push('submit');
    st.submits.push(xdr);
    st.substitui.push(opts?.substitui);
    await Promise.resolve();
    const t = st.built.find((b) => b.xdr === xdr)!;
    const outcome = st.submitScript.shift() ?? 'SUCCESS';
    if (outcome === 'ERRO_COMUM') throw new Error('falha de rede qualquer');
    if (outcome === 'SEQ_CONSUMIDA') {
      throw Object.assign(new Error('sequence consumida'), { code: 'EMISSAO_SEQUENCIA_CONSUMIDA', hash: 'hashAnterior' });
    }
    if (outcome === 'ANTERIOR_EMITIU') {
      const ant = st.built.find((b) => b.xdr === opts?.substitui)!; // a ANTERIOR emitiu, não a nova
      st.chain.set(ant.hash, { successful: true, amount: ant.amount, memoHex: ant.memoHex });
      return { status: 'SUCCESS', hash: ant.hash };
    }
    if (outcome === 'SUCCESS') {
      st.chain.set(t.hash, { successful: true, amount: t.amount, memoHex: t.memoHex });
      return { status: 'SUCCESS', hash: t.hash };
    }
    if (outcome === 'FAILED') return { status: 'FAILED', hash: t.hash, resultCodes: { transaction: 'tx_failed' } };
    if (outcome === 'FAILED_TOO_LATE') return { status: 'FAILED', hash: t.hash, resultCodes: { transaction: 'tx_too_late' } };
    if (outcome === 'AMBIGUOUS_LANDS') st.chain.set(t.hash, { successful: true, amount: t.amount, memoHex: t.memoHex });
    return { status: 'AMBIGUOUS', hash: t.hash, reason: 'timeout' };
  }),
  quemConsumiuSequence: vi.fn(async (xdrs: string[], opts?: { hashesConhecidos?: string[] }) => {
    st.calls.push('consumo');
    st.consumoArgs.push(xdrs);
    st.consumoHashes.push(opts?.hashesConhecidos);
    if (st.consumo instanceof Error) throw st.consumo;
    return st.consumo ?? { status: 'INDETERMINADO', motivo: 'sem forçar' };
  }),
  buscarTxPorHash: vi.fn(async (hash: string) => {
    st.calls.push('buscarHash');
    if (st.failBuscarHash) throw st.failBuscarHash;
    const forcada = st.hashScript.shift();
    if (forcada) return forcada;
    const t = st.chain.get(hash);
    return t ? { found: true, successful: t.successful, ledgerCloseTime: 'x' } : { found: false };
  }),
  txExpirouNaRede: vi.fn(async (xdr: string) => {
    st.calls.push('expirou');
    if (st.expiry instanceof Error) throw st.expiry;
    const t = st.built.find((b) => b.xdr === xdr)!;
    const entrou = st.chain.get(t.hash);
    if (entrou) return { status: 'ENTROU', hash: t.hash, successful: entrou.successful, ledger: 1 };
    if (st.expiry === 'EM_ABERTO') return { status: 'EM_ABERTO', hash: t.hash, maxTime: t.maxTime };
    return { status: 'EXPIROU', hash: t.hash, maxTime: t.maxTime, ledgerAposPrazo: 2, fechadoEm: 'x' };
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
  const tx = { cota, eventoAudit, movimentoFundo, tentativaEmissao, $executeRaw: vi.fn(async () => { st.calls.push('lock'); return 0; }) };
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
      quote: { findFirst: async () => null }, // lerSupplyDoNav: nenhum swap em voo (gate do N1)
      resgateCotacao: { findFirst: async () => null },
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
  st.built = []; st.submits = []; st.submitScript = []; st.substitui = []; st.buildErro = null; st.consumo = null; st.consumoArgs = []; st.consumoHashes = []; st.calls = [];
  st.ancoras = []; st.ancoraFalha = null;
  st.failAuditOnce = false; st.hashScript = []; st.failBuscarHash = null; st.failBuscarMemo = null; st.expiry = null; st.tail = Promise.resolve();
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

  it('se a tx NUNCA entrou: só quando o Horizon confirma EXPIROU sai tx nova, e a emissão acontece uma vez', async () => {
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(119_000); // ainda antes do maxTime: reenvia o MESMO XDR (ambíguo de novo)
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1);
    expect(st.submits).toEqual(['XDR1', 'XDR1']);
    avancar(2_000); // o relógio local já passou do maxTime, mas a rede ainda não fechou ledger depois dele
    st.expiry = 'EM_ABERTO';
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1); // o relógio não decide: nenhuma tx nova
    expect(st.submits).toEqual(['XDR1', 'XDR1']); // e depois do maxTime não reenvia
    st.expiry = null; // a rede fechou ledger depois do maxTime e a tx não está em nenhum: EXPIROU
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

  it('reenvio com FAILED e a tx não está no ledger → AMBÍGUO (Argus): PENDENTE, nunca FALHOU nem sequence nova; depois do prazo a substituição usa a MESMA sequence', async () => {
    st.submitScript = ['AMBIGUOUS', 'FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(10_000);
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' }); // não FALHOU
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.built).toHaveLength(1); // nenhuma tx nova
    avancar(130_000); // prazo vencido; o Horizon (mock) diz EXPIROU
    const r = await incorporarCota(base);
    expect(st.built[1].sequence).toBe(st.built[0].sequence); // MESMA sequence, não sequence nova
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

describe('incorporarCota — expiração decidida pelo Horizon (R1 do Argus, txExpirouNaRede)', () => {
  it('depois do maxTime, ENTROU com sucesso: confirma pela tx guardada, sem tx nova e sem reenviar', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    st.hashScript = [{ found: false }]; // a busca rápida por hash não a vê (nó atrasado), a varredura vê
    avancar(130_000);
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.built).toHaveLength(1);
    expect(st.submits).toEqual(['XDR1']);
    expect(st.calls).toContain('expirou');
    expect(emissoes()).toBe(1);
  });

  it('depois do maxTime, ENTROU mas FALHOU on-chain: nada emitido, libera tx nova', async () => {
    st.submitScript = ['AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: false, amount: '400.0000000', memoHex: memoDe('ces_1') });
    st.hashScript = [{ found: false }];
    avancar(130_000);
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash2');
    expect(st.tentativas.get(memoDe('ces_1'))!.historico[0]).toMatchObject({ txHash: 'hash1', status: 'FALHOU' });
  });

  it('depois do maxTime, exceção da primitiva = indeterminado: não reemite, mantém a tentativa PENDENTE', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(130_000);
    st.expiry = new Error('Expiração indeterminada: ledger 404 STELLAR_HORIZON_URL');
    const err = await incorporarCota(base).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoEmissaoError);
    expect(err.code).toBe('EMISSAO_EM_ANDAMENTO');
    expect(err.message).not.toMatch(/indeterminada|STELLAR_/);
    expect(st.built).toHaveLength(1);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.cotas.size).toBe(0);
  });

  it('antes do maxTime não consulta a varredura (reenvia o mesmo XDR)', async () => {
    st.submitScript = ['AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(30_000);
    await incorporarCota(base);
    expect(st.calls).not.toContain('expirou');
    expect(st.submits).toEqual(['XDR1', 'XDR1']);
  });

  it('EXPIROU guarda a tentativa antiga no histórico e a tx nova sai da mesma incorporação (mesmo memo)', async () => {
    st.submitScript = ['AMBIGUOUS', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(130_000);
    await incorporarCota(base);
    expect(st.built[1].memoHex).toBe(st.built[0].memoHex);
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.historico).toHaveLength(1);
    expect(t.historico[0]).toMatchObject({ txHash: 'hash1', status: 'EXPIRADA' });
  });
});

describe('incorporarCota — substituição com a MESMA sequence (contrato da Estela, decisão do Atlas)', () => {
  /** 1º envio ambíguo e o relógio passa do maxTime (a rede ainda não confirmou nada). */
  async function expirada() {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(130_000); // txExpirouNaRede (mock) responde EXPIROU
  }

  it('EXPIROU: a substituição usa sequenceDe = envelope anterior, mesmo valor, e o submit leva { substitui }', async () => {
    await expirada();
    const r = await incorporarCota(base);
    expect(st.built).toHaveLength(2);
    expect(st.built[1].sequenceDe).toBe('XDR1');
    expect(st.built[1].sequence).toBe(st.built[0].sequence); // MESMA sequence
    expect(st.built[1].amount).toBe(st.built[0].amount); // mesmo valor
    expect(st.built[1].memoHex).toBe(st.built[0].memoHex); // mesmo memo
    expect(st.submits).toEqual(['XDR1', 'XDR2']);
    expect(st.substitui).toEqual([undefined, 'XDR1']);
    expect(r.txHash).toBe('hash2');
    expect(emissoes()).toBe(1);
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.sequence).toBe(st.built[0].sequence);
    expect(t.historico).toHaveLength(1);
    expect(t.historico[0]).toMatchObject({ txHash: 'hash1', envelopeXdr: 'XDR1', status: 'EXPIRADA', sequence: st.built[0].sequence });
  });

  it('a ANTERIOR emitiu (SUCCESS com o hash anterior): o domínio grava o hash da anterior', async () => {
    await expirada();
    st.submitScript = ['ANTERIOR_EMITIU'];
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect([...st.cotas.values()][0].emissaoTxHash).toBe('hash1');
    expect(st.tentativas.get(memoDe('ces_1'))!.txHash).toBe('hash1');
    expect(emissoes()).toBe(1);
  });

  it('SEQUENCIA_CONSUMIDA + a nossa entrou com sucesso: confirma com esse hash, sem tx nova', async () => {
    await expirada();
    st.submitScript = ['SEQ_CONSUMIDA'];
    st.consumo = { status: 'ANTIGA_ENTROU', hash: 'hash1', successful: true, ledger: 9 };
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.built).toHaveLength(2); // só a substituição, nenhuma terceira
    expect(st.consumoArgs[0]).toEqual(['XDR1', 'XDR2']); // as duas que usaram a mesma sequence
    expect(st.cotas.size).toBe(1);
  });

  it('cenário do Argus (Q1): original A + duas substituições; quemConsumiuSequence recebe o XDR de TODAS as tentativas', async () => {
    await expirada(); // A (XDR1) ambígua e expirada
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' }); // R1 (XDR2), ambígua
    avancar(130_000); // R1 também expira
    st.submitScript = ['SEQ_CONSUMIDA'];
    st.consumo = { status: 'ANTIGA_ENTROU', hash: 'hash1', successful: true, ledger: 9 }; // foi a A que entrou
    const r = await incorporarCota(base); // R2 (XDR3): tx_bad_seq → quem consumiu a sequence?
    expect(st.built.map((b) => b.sequence)).toEqual([st.built[0].sequence, st.built[0].sequence, st.built[0].sequence]);
    expect(st.consumoArgs[0]).toEqual(['XDR1', 'XDR2', 'XDR3']); // A, R1 e R2: nenhuma fica de fora
    expect(st.consumoHashes[0]).toEqual(['hash1', 'hash2', 'hash3']); // e o txHash de todas (hashesConhecidos)
    expect(r.txHash).toBe('hash1'); // confirma a A; nada de tx com sequence nova
    expect(st.built).toHaveLength(3);
    expect(st.cotas.size).toBe(1);
  });

  it('SEQUENCIA_CONSUMIDA + a nossa entrou e FALHOU: libera tx com sequence NOVA, uma emissão', async () => {
    await expirada();
    st.submitScript = ['SEQ_CONSUMIDA', 'SUCCESS'];
    st.consumo = { status: 'ANTIGA_ENTROU', hash: 'hash1', successful: false, ledger: 9 };
    const r = await incorporarCota(base);
    expect(st.built).toHaveLength(3);
    expect(st.built[2].sequenceDe).toBeUndefined();
    expect(st.built[2].sequence).not.toBe(st.built[0].sequence); // sequence nova
    expect(r.txHash).toBe('hash3');
    expect(emissoes()).toBe(1);
  });

  it('SEQUENCIA_CONSUMIDA + OUTRA tx do issuer consumiu: EXPIRADA e tx com sequence NOVA', async () => {
    await expirada();
    st.submitScript = ['SEQ_CONSUMIDA', 'SUCCESS'];
    st.consumo = { status: 'OUTRA_TX', hash: 'hashOutra' };
    const r = await incorporarCota(base);
    expect(st.built[2].sequenceDe).toBeUndefined();
    expect(st.built[2].sequence).not.toBe(st.built[0].sequence);
    expect(r.txHash).toBe('hash3');
    expect(emissoes()).toBe(1);
    expect(st.tentativas.get(memoDe('ces_1'))!.historico.map((h: { status: string }) => h.status)).toEqual(['EXPIRADA', 'EXPIRADA']);
  });

  it('SEQUENCIA_CONSUMIDA + indeterminado (ou Horizon fora): mantém PENDENTE, nada reemitido', async () => {
    await expirada();
    st.submitScript = ['SEQ_CONSUMIDA'];
    st.consumo = { status: 'INDETERMINADO', motivo: 'sequence não aparece na página' };
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(2);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.cotas.size).toBe(0);

    st.submitScript = ['SEQ_CONSUMIDA'];
    st.consumo = new Error('horizon fora');
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(2);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
  });

  it('a primitiva recusa a substituição (ISSUE_SUBSTITUICAO_INVALIDA / Horizon fora): não substitui nem reemite', async () => {
    await expirada();
    st.buildErro = Object.assign(new Error('não expirou'), { code: 'ISSUE_SUBSTITUICAO_INVALIDA' });
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1);
    expect(st.submits).toEqual(['XDR1']);
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.status).toBe('PENDENTE');
    expect(t.txHash).toBe('hash1'); // a tentativa original continua como está
    expect(t.historico).toHaveLength(0);
  });

  it('valor de aporte diferente do guardado: a substituição (mesmo valor) não é montada', async () => {
    await expirada();
    await expect(incorporarCota({ ...base, valorCarta: '600' })).rejects.toMatchObject({ code: 'VALOR_DIVERGE_DA_TENTATIVA' });
    expect(st.built).toHaveLength(1);
  });

  it('reenvio de uma substituição ambígua (dentro do novo maxTime) leva { substitui } do envelope anterior', async () => {
    await expirada();
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' }); // substituição ambígua
    avancar(30_000);
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' }); // reenvio do XDR2
    expect(st.built).toHaveLength(2);
    expect(st.submits).toEqual(['XDR1', 'XDR2', 'XDR2']);
    expect(st.substitui).toEqual([undefined, 'XDR1', 'XDR1']);
  });

  it('erro comum (não EmissaoError) no submit da substituição mantém PENDENTE: nunca FALHOU/EXPIRADA', async () => {
    await expirada();
    st.submitScript = ['ERRO_COMUM'];
    await expect(incorporarCota(base)).rejects.toThrow('falha de rede qualquer');
    const t = st.tentativas.get(memoDe('ces_1'))!;
    expect(t.status).toBe('PENDENTE');
    expect(st.cotas.size).toBe(0);
  });
});

describe('incorporarCota — tx_too_late não é falha definitiva (F1 da Vera)', () => {
  it('reenvio com FAILED tx_too_late e 404 por hash: nenhuma tx nova, tentativa PENDENTE, sem FALHOU', async () => {
    st.submitScript = ['AMBIGUOUS', 'FAILED_TOO_LATE'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(30_000);
    // a tx pode já ter entrado (Horizon atrasado: 404 por hash); o core devolve tx_too_late ao reenviar
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(1);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.cotas.size).toBe(0);
    // depois do maxTime a próxima chamada decide pelo Horizon + substituição com a MESMA sequence
    avancar(100_000);
    st.submitScript = ['ANTERIOR_EMITIU'];
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.built[1].sequence).toBe(st.built[0].sequence);
    expect(emissoes()).toBe(1);
  });

  it('1º envio com FAILED tx_too_late também não marca FALHOU', async () => {
    st.submitScript = ['FAILED_TOO_LATE'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.built).toHaveLength(1);
  });

  it('FAILED com outro código segue definitivo (FALHOU + tx nova), como antes', async () => {
    st.submitScript = ['FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('FALHOU');
  });
});

describe('incorporarCota — FAILED de envelope salvo é ambíguo (parecer do Argus)', () => {
  it('FAILED no submit da SUBSTITUIÇÃO (não é tx_bad_seq) também fica PENDENTE: sem FALHOU nem sequence nova', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    avancar(130_000); // EXPIROU → substituição
    st.submitScript = ['FAILED'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    expect(st.built).toHaveLength(2); // só a substituição, nenhuma terceira
    expect(st.built[1].sequence).toBe(st.built[0].sequence);
    expect(st.tentativas.get(memoDe('ces_1'))!.status).toBe('PENDENTE');
    expect(st.cotas.size).toBe(0);
  });

  it('o FAILED do 1º submit de tx nova continua definitivo (FALHOU, nova tentativa)', async () => {
    st.submitScript = ['FAILED', 'SUCCESS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash2');
    expect(emissoes()).toBe(1);
  });
});


describe('E1-p — registro da incorporação ancorado ANTES da emissão', () => {
  it('tx nova: âncora antes do build e do submit, com os números exatos da emissão; evento leva payloadHash = memo e o registro', async () => {
    const r = await incorporarCota(base);
    expect(st.calls.indexOf('ancora')).toBeGreaterThanOrEqual(0);
    expect(st.calls.indexOf('ancora')).toBeLessThan(st.calls.indexOf('build'));
    expect(st.calls.indexOf('ancora')).toBeLessThan(st.calls.indexOf('submit'));
    expect(st.calls.filter((c) => c === 'ancora')).toHaveLength(1); // sem 2ª busca logo depois de ancorar
    expect(st.ancoras[0]).toMatchObject({ tokensEmitir: '400.0000000', navPorTokenUsado: '1.00000000' });
    expect(st.built[0].amount).toBe(st.ancoras[0].tokensEmitir);
    const ev = st.audits.find((a) => a.acao === 'COTA_INCORPORADA')!;
    expect(ev.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.payloadJson.registroCanonico).toMatchObject({ tipo: 'COTA_INCORPORADA', cotaId: r.cotaId, tokensEmitir: '400.0000000' });
    expect(ev.payloadJson.ancoraTxHash).toBe(`ancora-${ev.payloadHash.slice(0, 8)}`);
    expect(ev.stellarTxHash).toBe(r.txHash); // a tx do evento continua sendo a de emissão
  });

  it('âncora falha → ANCORA_INCORPORACAO_FALHOU: nada construído, nada enviado, nada gravado', async () => {
    st.ancoraFalha = new Error('x');
    const err = await incorporarCota(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncorporacaoBloqueadaError);
    expect((err as IncorporacaoBloqueadaError).code).toBe('ANCORA_INCORPORACAO_FALHOU');
    expect(st.built).toHaveLength(0);
    expect(st.submits).toHaveLength(0);
    expect(st.tentativas.size).toBe(0);
    expect(st.cotas.size).toBe(0);
    expect(st.audits).toHaveLength(0);
  });

  it('recuperação (emissão ambígua que entra): a âncora é reencontrada com os números da tentativa e desde = criação da tentativa', async () => {
    st.submitScript = ['AMBIGUOUS_LANDS'];
    await expect(incorporarCota(base)).rejects.toBeInstanceOf(IncorporacaoEmissaoError);
    const t = [...st.tentativas.values()][0];
    t.criadaEm = new Date(T0 - 60_000);
    st.ancoras = []; st.calls = [];
    await incorporarCota(base);
    expect(st.calls).not.toContain('build'); // não remonta emissão
    expect(st.ancoras).toHaveLength(1);
    expect(st.ancoras[0]).toMatchObject({ tokensEmitir: '400.0000000', navPorTokenUsado: '1.00000000' });
    expect(st.ancoras[0].desde.getTime()).toBe(T0 - 60_000);
    expect(st.audits.find((a) => a.acao === 'COTA_INCORPORADA')!.payloadJson.registroCanonico).toBeDefined();
  });

  it('emissão antiga achada só pelo memo (legado): sem registro, sem âncora depois da emissão', async () => {
    st.chain.set('hashLegado', { successful: true, amount: '400.0000000', memoHex: memoDe('ces_1') });
    await incorporarCota(base);
    expect(st.calls).not.toContain('ancora');
    const ev = st.audits.find((a) => a.acao === 'COTA_INCORPORADA')!;
    expect(ev.payloadJson.registroCanonico).toBeUndefined();
    expect(ev.payloadJson.recuperadaPorMemo).toBe(true);
  });
});
