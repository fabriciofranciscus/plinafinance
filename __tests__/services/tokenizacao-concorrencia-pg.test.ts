/**
 * Concorrência REAL da TentativaEmissao no Postgres (pedido do Argus, E1-4 R1).
 *
 * Só roda com um Postgres descartável em TEST_PG_URL (localhost; as migrations aplicadas):
 *   TEST_PG_URL=postgresql://user@127.0.0.1:5432/plina_test pnpm vitest run \
 *     __tests__/services/tokenizacao-concorrencia-pg.test.ts
 * Sem a variável o arquivo é pulado (a suíte padrão não depende de banco). Recusa qualquer
 * host que não seja local: nunca roda contra o Neon. O Stellar é simulado; o banco é de verdade
 * (advisory lock, commit da tentativa fora da transação, `aplicadaEm` na mesma transação da Cota).
 */
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    }
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

const st = vi.hoisted(() => ({
  chain: new Map<string, { successful: boolean }>(),
  built: [] as Array<{ hash: string; xdr: string }>,
  submits: [] as string[],
  submitScript: [] as Array<'SUCCESS' | 'AMBIGUOUS'>,
  fetchSupplyDasClasses: vi.fn(),
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => 'TESTNET', enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  buildIssueAssetTx: vi.fn(async () => {
    const n = st.built.length + 1;
    const t = { hash: `hash${n}`, xdr: `XDR${n}` };
    st.built.push(t);
    await new Promise((r) => setTimeout(r, 25)); // dá chance real ao outro chamador
    return { ...t, maxTime: Math.floor(Date.now() / 1000) + 120 };
  }),
  submitEnvelope: vi.fn(async (xdr: string) => {
    st.submits.push(xdr);
    await new Promise((r) => setTimeout(r, 10));
    const t = st.built.find((b) => b.xdr === xdr)!;
    const out = st.submitScript.shift() ?? 'SUCCESS';
    if (out === 'SUCCESS') {
      st.chain.set(t.hash, { successful: true });
      return { status: 'SUCCESS', hash: t.hash };
    }
    return { status: 'AMBIGUOUS', hash: t.hash, reason: 'timeout' };
  }),
  buscarTxPorHash: vi.fn(async (hash: string) => {
    const t = st.chain.get(hash);
    return t ? { found: true, successful: t.successful, ledgerCloseTime: 'x' } : { found: false };
  }),
  buscarEmissaoPorMemo: vi.fn(async () => null),
  txExpirouNaRede: vi.fn(async (xdr: string) => {
    const t = st.built.find((b) => b.xdr === xdr)!;
    return { status: 'EM_ABERTO', hash: t.hash, maxTime: 0 };
  }),
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({}) }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.fetchSupplyDasClasses }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { incorporarCota } from '@/lib/services/tokenizacao';
import { lerSupplyDoNav, resetNavSupplyCache } from '@/lib/services/nav-supply';

const HASH = 'b'.repeat(64);
const base = {
  tipoBem: 'VEICULO' as never,
  administradora: 'X',
  valorCarta: '500',
  desagioAquisicao: '0.20',
  operador: 'admin',
  hashValidacao: HASH,
};
const supply = (c: string) => ({ circulante: new Prisma.Decimal(c), tesouraria: new Prisma.Decimal('0') }) as never;

describe.skipIf(!PG)('TentativaEmissao — concorrência real no Postgres', () => {
  beforeAll(() => {
    process.env.STELLAR_ISSUER_SECRET = 'S-test';
    process.env.STELLAR_PLINA_POSITION_PUBLIC = Keypair.random().publicKey();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.chain = new Map(); st.built = []; st.submits = []; st.submitScript = [];
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
    resetNavSupplyCache();
    await db.$executeRawUnsafe(
      'TRUNCATE "TentativaEmissao", "MovimentoFundo", "EventoAudit", "Cota" RESTART IDENTITY CASCADE',
    );
    await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', payloadHash: HASH, stellarTxHash: 'txLaudo' } });
    await db.eventoAudit.create({
      data: { acao: 'ANUENCIA_REGISTRADA', payloadJson: { hashValidacao: HASH, status: 'DECLARADA_PENDENTE' } },
    });
  });

  it('duas chamadas simultâneas com envio ambíguo: UMA tx construída, o mesmo XDR reenviado, nada no domínio', async () => {
    st.submitScript = ['AMBIGUOUS', 'AMBIGUOUS'];
    const r = await Promise.allSettled([incorporarCota(base), incorporarCota(base)]);
    for (const x of r) {
      expect(x.status).toBe('rejected');
      expect((x as PromiseRejectedResult).reason).toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    }
    expect(st.built).toHaveLength(1); // o advisory lock serializou: sem 2ª tx
    expect(st.submits).toEqual(['XDR1', 'XDR1']);
    expect(await db.cota.count()).toBe(0);
    expect(await db.movimentoFundo.count()).toBe(0);
    const t = await db.tentativaEmissao.findMany();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: 'PENDENTE', txHash: 'hash1', aplicadaEm: null });
  });

  it('com a tentativa PENDENTE o NAV fica indisponível (banco real); aplicada, o NAV volta', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    await expect(lerSupplyDoNav({ fresh: true })).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });

    st.chain.set('hash1', { successful: true }); // a tx entrou
    await incorporarCota(base);
    const t = await db.tentativaEmissao.findFirstOrThrow();
    expect(t.aplicadaEm).toBeInstanceOf(Date);
    resetNavSupplyCache();
    await expect(lerSupplyDoNav({ fresh: true })).resolves.toBeDefined();
  });

  it('chamadas simultâneas depois que a tx entrou: UMA Cota, UM aporte, a tentativa aplicada uma vez', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: true });

    const r = await Promise.all([incorporarCota(base), incorporarCota(base), incorporarCota(base)]);
    expect(new Set(r.map((x) => x.cotaId)).size).toBe(1);
    expect(new Set(r.map((x) => x.txHash))).toEqual(new Set(['hash1']));
    expect(await db.cota.count()).toBe(1);
    expect(await db.movimentoFundo.count({ where: { tipo: 'APORTE_COTA' } })).toBe(1);
    expect(st.built).toHaveLength(1);
    expect(await db.eventoAudit.count({ where: { acao: 'TOKEN_EMITIDO' } })).toBe(1);
  });

  it('chamadas simultâneas na 1ª emissão (sem erro ambíguo): uma tx, uma Cota', async () => {
    const r = await Promise.all([incorporarCota(base), incorporarCota(base)]);
    expect(r[0].cotaId).toBe(r[1].cotaId);
    expect(st.built).toHaveLength(1);
    expect(st.submits).toHaveLength(1);
    expect(await db.cota.count()).toBe(1);
    expect(await db.movimentoFundo.count({ where: { tipo: 'APORTE_COTA' } })).toBe(1);
  });
});
