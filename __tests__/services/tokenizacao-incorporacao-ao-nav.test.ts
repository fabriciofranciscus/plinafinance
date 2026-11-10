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
  chain: new Map<string, { txHash: string; amount: string }>(),
  calls: [] as string[],
  failChain: false,
  failAuditOnce: false,
  failBuscar: null as Error | null,
  fetchSupplyDasClasses: vi.fn(),
  eventoFind: vi.fn(),
  tail: Promise.resolve() as Promise<unknown>,
  txCount: 0,
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => st.cfg.network, enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  issueAsset: vi.fn(async (_s: unknown, _d: string, amount: string, _code: string, opts?: { memoHash?: Buffer }) => {
    st.calls.push('issueAsset');
    await Promise.resolve();
    if (st.failChain) throw new Error('tx_bad_auth S-test-secret');
    const txHash = `tx${st.chain.size + 1}`;
    if (opts?.memoHash) st.chain.set(opts.memoHash.toString('hex'), { txHash, amount });
    return { hash: txHash };
  }),
  buscarEmissaoPorMemo: vi.fn(async ({ memoHash }: { memoHash: Buffer }) => {
    st.calls.push('buscar');
    if (st.failBuscar) throw st.failBuscar;
    return st.chain.get(memoHash.toString('hex')) ?? null;
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
  const tx = { cota, eventoAudit, movimentoFundo, $queryRaw: vi.fn(async () => { st.calls.push('lock'); return []; }) };
  const run = async (fn: (t: typeof tx) => Promise<unknown>) => {
    const snap = { cotas: new Map([...st.cotas].map(([k, v]) => [k, { ...v }])), audits: [...st.audits], movs: [...st.movs] };
    try {
      st.txCount++;
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
  atualizarStatusCota,
  incorporarCota,
  memoHashDaIncorporacao,
} from '@/lib/services/tokenizacao';
import { NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';
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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.STELLAR_ISSUER_SECRET = 'S-test';
  process.env.STELLAR_PLINA_POSITION_PUBLIC = POSICAO;
  st.cfg.network = 'TESTNET';
  st.cotas = new Map(); st.audits = []; st.movs = []; st.chain = new Map(); st.calls = [];
  st.failChain = false; st.failAuditOnce = false; st.failBuscar = null; st.tail = Promise.resolve(); st.txCount = 0;
  resetNavSupplyCache();
  evidencias();
  st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
});
afterEach(() => vi.restoreAllMocks());

const emissoes = () => st.calls.filter((c) => c === 'issueAsset').length;

describe('incorporarCota — aporte ao NAV', () => {
  it('1ª incorporação com supply zero: R$ 400 → 400 PLINARF, para a posição da Plina, com code e memo', async () => {
    const r = await incorporarCota(base);
    expect(r.tokensEmitidos).toBe(400);
    const { issueAsset } = await import('@/lib/stellar/issuer');
    const [, dest, amount, code, opts] = (issueAsset as any).mock.calls[0];
    expect(dest).toBe(POSICAO);
    expect(amount).toBe('400.0000000');
    expect(code).toBe('PLINARF');
    expect(opts.memoHash.equals(createHash('sha256').update('plina:incorporacao:ces_1').digest())).toBe(true);
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

  it('DB depois da chain: nada é gravado antes de issueAsset; grava cota + audits + APORTE_COTA só depois', async () => {
    await incorporarCota({ ...base, pixValorBrl: '400.00', pixHash: 'pixTx' });
    const iChain = st.calls.indexOf('issueAsset');
    expect(iChain).toBeGreaterThan(-1);
    for (const w of ['cota.create', 'audit.create', 'mov.create']) {
      expect(st.calls.indexOf(w)).toBeGreaterThan(iChain);
    }
    expect(st.calls.indexOf('lock')).toBeLessThan(iChain); // lock não grava linha de domínio
    const cota = [...st.cotas.values()][0];
    expect(cota).toMatchObject({ status: 'DISPONIVEL', emissaoTxHash: 'tx1', hashValidacao: HASH, anuenciaStatus: 'DECLARADA_PENDENTE', cessaoId: 'ces_1' });
    expect(cota.id).toMatch(/^inc_[0-9a-f]{32}$/);
    expect(st.audits.map((a) => a.acao)).toEqual(['COTA_INCORPORADA', 'TOKEN_EMITIDO']);
    const mov = st.movs[0];
    expect(mov).toMatchObject({ tipo: 'APORTE_COTA', refHash: 'pixTx', hashValidacao: HASH, txHash: 'tx1', chave: `aporte-cota:${cota.id}` });
    expect(mov.deltaCaixa.toString()).toBe('0'); // nunca AQUISICAO: o fundo não pagou a cota
    expect(mov.valorBrl.toFixed(2)).toBe('400.00');
    expect(mov.deltaTokens.toFixed(7)).toBe('400.0000000');
    expect(mov.navPorToken.toFixed(8)).toBe('1.00000000');
  });

  it('falha na chain: NADA gravado (sem cota, sem audit, sem movimento) e mensagem sem segredo', async () => {
    st.failChain = true;
    const err = await incorporarCota(base).catch((e) => e);
    expect(err.message).toMatch(/nada foi gravado/);
    expect(err.message).not.toMatch(/S-test|tx_bad_auth/);
    expect(st.cotas.size).toBe(0);
    expect(st.audits).toHaveLength(0);
    expect(st.movs).toHaveLength(0);
  });

  it('crash entre submit e commit: a nova chamada acha a emissão pelo memo, grava e NÃO reemite', async () => {
    st.failAuditOnce = true; // chain ok, banco cai antes do commit
    await expect(incorporarCota(base)).rejects.toThrow('db caiu');
    expect(emissoes()).toBe(1);
    expect(st.chain.size).toBe(1);
    expect(st.cotas.size).toBe(0); // rollback: nenhuma linha sem a tx corresponde

    const r = await incorporarCota(base);
    expect(emissoes()).toBe(1); // continua 1 emissão
    expect(r.txHash).toBe('tx1');
    expect(r.tokensEmitidos).toBe(400);
    expect(st.cotas.size).toBe(1);
    expect(st.audits[0].payloadJson.recuperadaPorMemo).toBe(true);
    expect(st.movs).toHaveLength(1);
    expect(st.movs[0].navPorToken.toFixed(8)).toBe('1.00000000'); // V ÷ q reconstruído
  });

  it('recuperação usa a quantidade EMITIDA, mesmo que o NAV do ledger já tenha mudado', async () => {
    st.failAuditOnce = true;
    await expect(incorporarCota(base)).rejects.toThrow('db caiu');
    // o supply do ledger já inclui os 400 emitidos; recalcular daria outro NAV/quantidade
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('400'), subordinada: supply('0') });
    const r = await incorporarCota(base);
    expect(r.tokensEmitidos).toBe(400);
    expect(emissoes()).toBe(1);
  });

  it('duas chamadas concorrentes: uma emissão só, as duas devolvem a mesma cota', async () => {
    const [a, b] = await Promise.all([incorporarCota(base), incorporarCota(base)]);
    expect(emissoes()).toBe(1);
    expect(st.cotas.size).toBe(1);
    expect(st.movs).toHaveLength(1);
    expect(a.cotaId).toBe(b.cotaId);
    expect(a.txHash).toBe(b.txHash);
  });

  it('reexecução depois de concluída é idempotente (não emite, não duplica)', async () => {
    const a = await incorporarCota(base);
    const b = await incorporarCota(base);
    expect(b).toMatchObject({ cotaId: a.cotaId, txHash: a.txHash });
    expect(emissoes()).toBe(1);
    expect(st.movs).toHaveLength(1);
  });

  it('falha de leitura da busca por memo é fail-closed: não emite às cegas', async () => {
    st.failBuscar = new Error('horizon down');
    await expect(incorporarCota(base)).rejects.toThrow('horizon down');
    expect(emissoes()).toBe(0);
    expect(st.cotas.size).toBe(0);
  });

  it('sem cessão a chave da emissão é o laudo', async () => {
    const { cessaoId: _omit, ...semCessao } = base;
    void _omit;
    await incorporarCota(semCessao);
    expect(st.chain.has(memoHashDaIncorporacao(HASH).toString('hex'))).toBe(true);
  });
});

describe('incorporarCota — emissão recusada (nada vai à chain)', () => {
  const recusa = async (input: Parameters<typeof incorporarCota>[0], code: string) => {
    const err = await incorporarCota(input).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoBloqueadaError);
    expect(err.code).toBe(code);
    expect(emissoes()).toBe(0);
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
