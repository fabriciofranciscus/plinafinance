/**
 * QA (Vera) — perna REALIZAR (E2-5 / Caminho A) com Postgres REAL: idempotência, concorrência e queda entre o memo on-chain e o
 * commit do banco. Mock só da âncora on-chain (`registerOnChainHash`); o banco, as transações e as constraints são de verdade.
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db pnpm vitest run __tests__/services/realizacao-recovery-pg.test.ts
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

const st = vi.hoisted(() => ({ atrasos: {} as Record<string, number>, memos: [] as string[], barreira: null as null | { n: number; chegaram: number; libera: () => void; espera: Promise<void> }, falhaMemo: false }));
vi.mock('@/lib/stellar/audit', async (orig) => {
  const m = await orig<typeof import('@/lib/stellar/audit')>();
  const { createHash } = await import('node:crypto');
  return {
    ...m,
    registerOnChainHash: async (payload: unknown) => {
      if (st.falhaMemo) throw new Error('horizon indisponível');
      const b = st.barreira;
      if (b) { b.chegaram += 1; if (b.chegaram >= b.n) b.libera(); await b.espera; }
      const tipo = (payload as { _type?: string })._type ?? '';
      if (st.atrasos[tipo]) await new Promise((r) => setTimeout(r, st.atrasos[tipo]));
      const payloadHash = createHash('sha256').update(JSON.stringify(payload) + st.memos.length).digest('hex');
      st.memos.push(payloadHash);
      return { payloadHash, txHash: payloadHash.slice(0, 64) };
    },
  };
});

import { db } from '@/lib/db';
import { cancelarReserva, criarReserva, executarCaminhoA } from '@/lib/services/realizacao';

const LIMPAR = 'TRUNCATE "RealizacaoCaminho", "MovimentoFundo", "Reserva", "LeadComprador", "Cota", "EventoAudit" RESTART IDENTITY CASCADE';
let seq = 0;
const novaBarreira = (n: number) => { let libera!: () => void; const espera = new Promise<void>((r) => { libera = r; }); st.barreira = { n, chegaram: 0, libera, espera }; };

async function cota(status: 'DISPONIVEL' | 'RESERVADA' = 'DISPONIVEL') {
  return db.cota.create({ data: { tipoBem: 'IMOVEL', administradora: 'Adm Teste', valorCarta: '100000.00', desagioAquisicao: '0.2000', desagioRevenda: '0.1000', status } });
}
async function lead() {
  seq += 1;
  return db.leadComprador.create({ data: { nome: `Comprador ${seq}`, email: `comprador${seq}@plina.test` } });
}
/** Cota RESERVADA + Reserva ATIVA (o estado de partida de `executarCaminhoA`). */
async function reservada() {
  const c = await cota('RESERVADA'); const l = await lead();
  const r = await db.reserva.create({ data: { cotaId: c.id, leadCompradorId: l.id, expiraEm: new Date(Date.now() + 3600_000), status: 'ATIVA' } });
  return { c, l, r };
}
const estado = async (cotaId: string, reservaId?: string) => ({
  cota: (await db.cota.findUniqueOrThrow({ where: { id: cotaId } })).status,
  reserva: reservaId ? (await db.reserva.findUniqueOrThrow({ where: { id: reservaId } })).status : undefined,
  realizacoes: await db.realizacaoCaminho.count({ where: { cotaId } }),
  movimentos: await db.movimentoFundo.count({ where: { tipo: 'REALIZACAO', cotaId } }),
});
const erro = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error | null;

/** Invariante de coerência da corrida cancelar × executar: ou a EXECUÇÃO prevaleceu inteira, ou o CANCELAMENTO prevaleceu inteiro. */
async function coerente(c: { id: string }, r: { id: string; leadCompradorId: string }) {
  const e = await estado(c.id, r.id);
  const cancelados = await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CANCELADA' } });
  const executados = await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'CAMINHO_A_EXECUTADO' } });
  const lead = (await db.leadComprador.findUniqueOrThrow({ where: { id: r.leadCompradorId } })).status;
  const execucaoVenceu = e.cota === 'REALIZADA' && e.reserva === 'CONFIRMADA' && e.realizacoes === 1 && e.movimentos === 1 && cancelados === 0 && executados === 1 && lead === 'FECHOU';
  const cancelamentoVenceu = e.cota === 'DISPONIVEL' && e.reserva === 'CANCELADA' && e.realizacoes === 0 && e.movimentos === 0 && cancelados === 1 && executados === 0 && lead !== 'FECHOU';
  return { ok: execucaoVenceu || cancelamentoVenceu, e, cancelados, executados, lead, execucaoVenceu };
}

describe.skipIf(!PG)('QA Vera — retest F-REAL-1 (escrita condicional, 255392e): corridas em Postgres real', () => {
  afterEach(async () => { await db.$executeRawUnsafe(LIMPAR); vi.restoreAllMocks(); st.barreira = null; st.falhaMemo = false; st.atrasos = {}; });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => { st.memos = []; st.barreira = null; st.falhaMemo = false; st.atrasos = {}; await db.$executeRawUnsafe(LIMPAR); });

  it('executar × cancelar em corrida NATURAL (barreira no memo, sem atraso forçado), 12 rodadas: SEMPRE um vencedor inteiro e o perdedor sem nenhum efeito (cota, reserva, caixa, audit, lead)', async () => {
    const vitorias = { execucao: 0, cancelamento: 0 };
    for (let i = 0; i < 12; i++) {
      st.memos = [];
      const { c, r } = await reservada();
      novaBarreira(2);
      const [ex, ca] = await Promise.all([
        erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' })),
        erro(cancelarReserva(r.id, 'op:b')),
      ]);
      const k = await coerente(c, r);
      expect(k.ok, JSON.stringify(k)).toBe(true);
      // exatamente UM dos dois falha, e com erro de estado
      expect([ex, ca].filter((x) => x === null)).toHaveLength(1);
      expect(String([ex, ca].find((x) => x !== null))).toMatch(/alterada concorrentemente/);
      expect(k.execucaoVenceu ? ex : ca).toBeNull();
      vitorias[k.execucaoVenceu ? 'execucao' : 'cancelamento'] += 1;
      expect(st.memos).toHaveLength(2); // o memo do perdedor já saiu e fica órfão (documentado)
    }
    expect(vitorias.execucao + vitorias.cancelamento).toBe(12);
  });

  it('as duas ordens FORÇADAS de commit (atraso por _type) também fecham coerentes, e o perdedor erra', async () => {
    for (const atrasos of [{ reserva_cancelada: 150 }, { caminho_a: 150 }]) {
      st.atrasos = atrasos; st.memos = [];
      const { c, r } = await reservada();
      novaBarreira(2);
      const [ex, ca] = await Promise.all([erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' })), erro(cancelarReserva(r.id, 'op:b'))]);
      const k = await coerente(c, r);
      expect(k.ok, JSON.stringify(k)).toBe(true);
      expect(k.execucaoVenceu).toBe('reserva_cancelada' in atrasos); // atraso no memo do cancelamento ⇒ a execução commita primeiro e vence
      expect(String(k.execucaoVenceu ? ca : ex)).toMatch(/alterada concorrentemente/);
    }
  });

  it('3 operadores ao mesmo tempo (executar, cancelar, executar): coerente; no máximo uma execução; sem audit duplicado', async () => {
    for (let i = 0; i < 6; i++) {
      const { c, r } = await reservada();
      novaBarreira(3);
      await Promise.all([
        erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' })),
        erro(cancelarReserva(r.id, 'op:b')),
        erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:c' })),
      ]);
      const k = await coerente(c, r);
      expect(k.ok, JSON.stringify(k)).toBe(true);
    }
  });

  it('2 cancelamentos simultâneos: EXATAMENTE 1 RESERVA_CANCELADA (a escrita condicional elimina o audit duplicado que antes era possível); o outro recebe erro de estado', async () => {
    for (let i = 0; i < 8; i++) {
      const { c, r } = await reservada();
      novaBarreira(2);
      const rs = await Promise.all([erro(cancelarReserva(r.id, 'op:a')), erro(cancelarReserva(r.id, 'op:b'))]);
      expect(rs.filter((x) => x === null)).toHaveLength(1);
      expect(String(rs.find((x) => x !== null))).toMatch(/alterada concorrentemente|não está/);
      expect(await estado(c.id, r.id)).toMatchObject({ cota: 'DISPONIVEL', reserva: 'CANCELADA' });
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CANCELADA' } })).toBe(1);
    }
  });

  it('a cota reservada de novo depois do cancelamento (outro comprador) não é desfeita por uma execução atrasada da reserva antiga', async () => {
    const { c, r } = await reservada();
    await cancelarReserva(r.id, 'op:b'); // cota DISPONIVEL
    const outro = await lead();
    await criarReserva({ cotaId: c.id, leadCompradorId: outro.id, operador: 'op:c' } as never).catch(() => null);
    const antes = await estado(c.id);
    const e = await erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' }));
    expect(e).not.toBeNull();
    expect(await estado(c.id)).toEqual(antes); // nenhuma escrita
    expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: { in: ['CAMINHO_A_EXECUTADO', 'COTA_REALIZADA'] } } })).toBe(0);
  });

  it('a RealizacaoCaminho (@unique cotaId) segue como segunda barreira: uma realização já gravada para a cota faz a outra execução falhar sem escrever', async () => {
    const { c, r } = await reservada();
    await executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' });
    const l2 = await lead();
    const r2 = await db.reserva.create({ data: { cotaId: c.id, leadCompradorId: l2.id, expiraEm: new Date(Date.now() + 3600_000), status: 'ATIVA' } });
    await db.cota.update({ where: { id: c.id }, data: { status: 'RESERVADA' } }); // estado forjado: cota "reservada" de novo
    const e = await erro(executarCaminhoA({ reservaId: r2.id, valorRealizado: '90000.00', operador: 'op:z' }));
    expect(String(e)).toMatch(/já realizada|alterada concorrentemente/);
    expect((await estado(c.id)).realizacoes).toBe(1);
    expect((await estado(c.id)).movimentos).toBe(1);
    expect((await db.reserva.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('ATIVA'); // a transação inteira foi desfeita
  });
});
