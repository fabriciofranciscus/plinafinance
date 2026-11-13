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

describe.skipIf(!PG)('Perna REALIZAR — recovery e idempotência (Postgres real)', () => {
  afterEach(async () => { await db.$executeRawUnsafe(LIMPAR); vi.restoreAllMocks(); st.barreira = null; st.falhaMemo = false; st.atrasos = {}; });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => { st.memos = []; st.barreira = null; st.falhaMemo = false; st.atrasos = {}; await db.$executeRawUnsafe(LIMPAR); });

  describe('executarCaminhoA', () => {
    it('caminho feliz: 1 RealizacaoCaminho, 1 movimento REALIZACAO (caixa = valor pago), Cota REALIZADA, Reserva CONFIRMADA, 2 audits com o hash do memo', async () => {
      const { c, r } = await reservada();
      const res = await executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' });
      expect(await estado(c.id, r.id)).toEqual({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
      const mov = await db.movimentoFundo.findFirstOrThrow({ where: { cotaId: c.id } });
      expect(mov.deltaCaixa.toFixed(2)).toBe('90000.00');
      expect(res.spread).toBe('10000.00'); // 90000 − custo 80000
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: { in: ['CAMINHO_A_EXECUTADO', 'COTA_REALIZADA'] } } })).toBe(2);
      expect(st.memos).toHaveLength(1);
    });

    it('REEXECUÇÃO depois de concluída: recusa (Reserva em estado CONFIRMADA) sem nenhum efeito (nem movimento, nem 2º registro, nem memo)', async () => {
      const { c, r } = await reservada();
      await executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' });
      const e = await erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' }));
      expect(e?.message).toMatch(/CONFIRMADA/);
      expect(await estado(c.id, r.id)).toEqual({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
      expect(st.memos).toHaveLength(1);
    });

    it('5 execuções SIMULTÂNEAS da mesma reserva (barreira no memo): UMA RealizacaoCaminho e UM movimento de caixa — o @unique(cotaId) desfaz as outras 4 (o NAV não infla); as 4 perdedoras já gravaram memo órfão', async () => {
      const { c, r } = await reservada();
      novaBarreira(5);
      const rs = await Promise.all(Array.from({ length: 5 }, () => erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' }))));
      expect(rs.filter((x) => x === null)).toHaveLength(1);
      expect(await estado(c.id, r.id)).toEqual({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
      expect(st.memos).toHaveLength(5); // 4 memos órfãos on-chain (documentado no código para a reserva; vale igual aqui)
    });

    it('QUEDA entre o memo on-chain e o commit do banco (a transação rejeita): NADA fica gravado, Reserva continua ATIVA e Cota RESERVADA; a repetição conclui com 1 só registro (o 1º memo fica órfão)', async () => {
      const { c, r } = await reservada();
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('conexão caiu depois do memo'));
      expect((await erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' })))?.message).toMatch(/conexão caiu/);
      expect(await estado(c.id, r.id)).toEqual({ cota: 'RESERVADA', reserva: 'ATIVA', realizacoes: 0, movimentos: 0 });
      vi.restoreAllMocks();
      await executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:maria' });
      expect(await estado(c.id, r.id)).toEqual({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
      expect(st.memos).toHaveLength(2);
    });

    it('Horizon indisponível ANTES do memo: falha limpa, nada gravado (fail-closed) e a repetição funciona', async () => {
      const { c, r } = await reservada();
      st.falhaMemo = true;
      expect((await erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op' })))?.message).toMatch(/horizon/);
      expect(await estado(c.id, r.id)).toEqual({ cota: 'RESERVADA', reserva: 'ATIVA', realizacoes: 0, movimentos: 0 });
      st.falhaMemo = false;
      await executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op' });
      expect((await estado(c.id, r.id)).movimentos).toBe(1);
    });

    it('entradas inválidas (valor 0/negativo/NaN/texto) recusadas ANTES do memo: nenhuma escrita on-chain nem no banco', async () => {
      const { c, r } = await reservada();
      for (const v of ['0', '-1', 'abc', '', 'NaN', 'Infinity']) expect(await erro(executarCaminhoA({ reservaId: r.id, valorRealizado: v, operador: 'op' }))).not.toBeNull();
      expect(st.memos).toHaveLength(0);
      expect(await estado(c.id, r.id)).toEqual({ cota: 'RESERVADA', reserva: 'ATIVA', realizacoes: 0, movimentos: 0 });
    });

    it('pré-condições: reserva inexistente, CANCELADA ou com a Cota fora de RESERVADA → recusa sem memo', async () => {
      const a = await reservada();
      await db.reserva.update({ where: { id: a.r.id }, data: { status: 'CANCELADA' } });
      const b = await reservada();
      await db.cota.update({ where: { id: b.c.id }, data: { status: 'DISPONIVEL' } });
      for (const id of ['nao_existe', a.r.id, b.r.id]) expect(await erro(executarCaminhoA({ reservaId: id, valorRealizado: '90000.00', operador: 'op' }))).not.toBeNull();
      expect(st.memos).toHaveLength(0);
    });
  });

  describe('criarReserva', () => {
    it('5 reservas SIMULTÂNEAS da mesma cota por 5 compradores: UMA Reserva ATIVA e Cota RESERVADA (o flip condicional é a barreira); 4 recusadas e 4 memos órfãos', async () => {
      const c = await cota(); const ls = await Promise.all([1, 2, 3, 4, 5].map(() => lead()));
      novaBarreira(5);
      const rs = await Promise.all(ls.map((l) => erro(criarReserva({ cotaId: c.id, leadCompradorId: l.id }))));
      expect(rs.filter((x) => x === null)).toHaveLength(1);
      // As perdedoras caem na unicidade de Reserva.cotaId do BANCO (P2002 cru); a mensagem 'reservada concorrentemente' do código é inalcançável.
      expect(rs.filter((x) => x && /Unique constraint/.test(x.message))).toHaveLength(4);
      expect(await db.reserva.count({ where: { cotaId: c.id } })).toBe(1);
      expect((await db.cota.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('RESERVADA');
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CRIADA' } })).toBe(1);
      expect(st.memos).toHaveLength(5);
    });

    it('o MESMO comprador reservando a mesma cota 5× em paralelo: 1 Reserva (sem reserva dupla para o mesmo lead)', async () => {
      const c = await cota(); const l = await lead();
      novaBarreira(5);
      const rs = await Promise.all(Array.from({ length: 5 }, () => erro(criarReserva({ cotaId: c.id, leadCompradorId: l.id }))));
      expect(rs.filter((x) => x === null)).toHaveLength(1);
      expect(await db.reserva.count({ where: { cotaId: c.id } })).toBe(1);
    });

    it('QUEDA entre o memo e o commit: nada gravado e a Cota segue DISPONIVEL; a repetição reserva (memo anterior órfão)', async () => {
      const c = await cota(); const l = await lead();
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('queda'));
      expect(await erro(criarReserva({ cotaId: c.id, leadCompradorId: l.id }))).not.toBeNull();
      expect(await db.reserva.count()).toBe(0);
      expect((await db.cota.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('DISPONIVEL');
      vi.restoreAllMocks();
      await criarReserva({ cotaId: c.id, leadCompradorId: l.id });
      expect(await db.reserva.count()).toBe(1);
      expect(st.memos).toHaveLength(2);
    });

    it('cota que não está DISPONIVEL, sem deságio de revenda, ou lead inexistente: recusa antes do memo', async () => {
      const l = await lead();
      const ocupada = await cota('RESERVADA');
      const semDesagio = await db.cota.create({ data: { tipoBem: 'IMOVEL', administradora: 'Adm', valorCarta: '1000', desagioAquisicao: '0.2', desagioRevenda: null } });
      for (const [cotaId, leadCompradorId] of [[ocupada.id, l.id], [semDesagio.id, l.id], ['x', l.id], [ocupada.id, 'y']] as const) expect(await erro(criarReserva({ cotaId, leadCompradorId }))).not.toBeNull();
      expect(st.memos).toHaveLength(0);
    });
  });

  describe('cancelarReserva e a corrida com executarCaminhoA', () => {
    it('cancelamento simples: Reserva CANCELADA, Cota volta a DISPONIVEL, 1 audit; repetir recusa sem efeito', async () => {
      const { c, r } = await reservada();
      await cancelarReserva(r.id, 'op:maria');
      expect(await estado(c.id, r.id)).toMatchObject({ cota: 'DISPONIVEL', reserva: 'CANCELADA', realizacoes: 0 });
      expect(await erro(cancelarReserva(r.id, 'op:maria'))).not.toBeNull();
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CANCELADA' } })).toBe(1);
    });

    // F-REAL-1: `cancelarReserva` e `executarCaminhoA` leem o estado, emitem o memo e SÓ DEPOIS escrevem, sem condição de estado na
    // escrita (`reserva.update where id`, `cota.update where id`). Duas ações de operador concorrentes sobre a MESMA reserva:
    const corrida = async (atrasos: Record<string, number>) => {
      st.atrasos = atrasos;
      const { c, r } = await reservada();
      novaBarreira(2);
      const [ex, ca] = await Promise.all([erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' })), erro(cancelarReserva(r.id, 'op:b'))]);
      return { c, r, ex, ca, e: await estado(c.id, r.id), cancelados: await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CANCELADA' } }) };
    };

    // Quem commita primeiro vence; o outro recebe erro de estado e NADA dele é gravado (escrita condicional, F-REAL-1).
    // O memo on-chain do perdedor já saiu e fica órfão (sem token nem dinheiro): são 2 memos nos dois casos.
    it('F-REAL-1a (MÉDIO) — executar commita PRIMEIRO, cancelar DEPOIS: vence a execução (REALIZADA + CONFIRMADA, 1 realização, 1 caixa); o cancelamento recebe erro de estado e a cota vendida NÃO volta ao estoque', async () => {
      const x = await corrida({ reserva_cancelada: 150 });
      expect(x.ex).toBeNull();
      expect(String(x.ca)).toMatch(/alterada concorrentemente/);
      expect(x.e).toEqual({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
      expect(st.memos).toHaveLength(2);
    });

    it('F-REAL-1b (BAIXO) — cancelar commita PRIMEIRO, executar DEPOIS: vence o cancelamento (DISPONIVEL + CANCELADA, 0 realização, 0 caixa, 1 evento RESERVA_CANCELADA); a execução recebe erro de estado e não grava realização, caixa nem audit', async () => {
      const x = await corrida({ caminho_a: 150 });
      expect(x.ca).toBeNull();
      expect(String(x.ex)).toMatch(/alterada concorrentemente/);
      expect(x.e).toEqual({ cota: 'DISPONIVEL', reserva: 'CANCELADA', realizacoes: 0, movimentos: 0 });
      expect(x.cancelados).toBe(1);
      expect(await db.eventoAudit.count({ where: { cotaId: x.c.id, acao: { in: ['CAMINHO_A_EXECUTADO', 'COTA_REALIZADA'] } } })).toBe(0);
      expect(st.memos).toHaveLength(2);
    });

    it('trilha coerente em qualquer ordem: o evento do vencedor existe e o do perdedor NÃO (RESERVA_CANCELADA só se a reserva terminou CANCELADA)', async () => {
      const casos: Array<Record<string, number>> = [{ reserva_cancelada: 150 }, { caminho_a: 150 }];
      for (const atrasos of casos) {
        st.memos.length = 0;
        const x = await corrida(atrasos);
        const canceladaFinal = x.e.reserva === 'CANCELADA';
        expect(x.cancelados).toBe(canceladaFinal ? 1 : 0);
        expect(await db.eventoAudit.count({ where: { cotaId: x.c.id, acao: 'CAMINHO_A_EXECUTADO' } })).toBe(canceladaFinal ? 0 : 1);
      }
    });

    it('2 execuções SIMULTÂNEAS da mesma reserva: 1 vence, a outra recebe erro de estado; 1 realização e 1 caixa (nada duplicado)', async () => {
      const { c, r } = await reservada();
      novaBarreira(2);
      const rs = await Promise.all([erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:a' })), erro(executarCaminhoA({ reservaId: r.id, valorRealizado: '90000.00', operador: 'op:b' }))]);
      expect(rs.filter((x) => x === null)).toHaveLength(1);
      expect(String(rs.find((x) => x !== null))).toMatch(/alterada concorrentemente|Reserva em estado|já realizada/);
      expect(await estado(c.id, r.id)).toMatchObject({ cota: 'REALIZADA', reserva: 'CONFIRMADA', realizacoes: 1, movimentos: 1 });
    });

    it('2 cancelamentos SIMULTÂNEOS da mesma reserva: o estado final é o certo (CANCELADA + cota DISPONIVEL) — caracterização: pode haver 2 eventos RESERVA_CANCELADA (audit duplicado)', async () => {
      const { c, r } = await reservada();
      novaBarreira(2);
      await Promise.all([erro(cancelarReserva(r.id, 'op:a')), erro(cancelarReserva(r.id, 'op:b'))]);
      expect(await estado(c.id, r.id)).toMatchObject({ cota: 'DISPONIVEL', reserva: 'CANCELADA' });
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'RESERVA_CANCELADA' } })).toBeGreaterThanOrEqual(1);
    });
  });
});
