/**
 * Clawback idempotente sob concorrência REAL no Postgres (U1-11; Argus com veto). Só roda com um Postgres descartável em TEST_PG_URL
 * (localhost, migrations aplicadas); sem a variável é pulado. O Stellar é simulado; o banco (advisory lock, evento, saldo) é de verdade.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
const st = vi.hoisted(() => ({ chamadas: 0, atraso: 80, falhaMemo: false, errosRede: [] as unknown[] }));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({}) }));
vi.mock('@/lib/stellar/issuer', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/issuer')>()),
  executeClawback: vi.fn(async () => { st.chamadas += 1; await new Promise((r) => setTimeout(r, st.atraso)); const e = st.errosRede.shift(); if (e) throw e; return { hash: `tx_claw_${st.chamadas}` }; }),
}));
vi.mock('@/lib/stellar/audit', () => ({
  buildAuditPayload: (_t: string, _i: string, x: object) => x,
  registerOnChainHash: vi.fn(async () => { if (st.falhaMemo) { st.falhaMemo = false; throw new Error('memo caiu'); } return { txHash: 'tx_memo', payloadHash: 'hash_memo' }; }),
}));

import { db } from '@/lib/db';
import { registerOnChainHash } from '@/lib/stellar/audit';
import { executarClawback, PRAZO_CONCLUSAO_CLAWBACK_MS } from '@/lib/services/tokenizacao';

const IN = { investidorId: 'inv_cb', amount: '100', motivo: 'ERRO_OPERACIONAL' as never, fundamentoUrl: 'https://x.test/d.pdf', operador: 'admin-panel', pedidoId: 'pedido-pg-0123456789abcd' };
const saldo = async () => Number((await db.investidor.findUniqueOrThrow({ where: { id: 'inv_cb' } })).saldoEsperado);

describe.skipIf(!PG)('clawback — idempotência sob concorrência real no Postgres', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    process.env.STELLAR_ISSUER_SECRET = 'SXXXX';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.chamadas = 0; st.falhaMemo = false; st.errosRede = [];
    await db.$executeRawUnsafe('TRUNCATE "EventoAudit", "HoldingPLINARF", "Investidor" RESTART IDENTITY CASCADE');
    await db.investidor.create({ data: { id: 'inv_cb', nome: 'Inv', email: 'inv@exemplo.test', publicKey: 'G' + 'A'.repeat(55), privyId: 'did:privy:cb', saldoEsperado: 1000 } });
  });

  it('DOIS envios simultâneos do MESMO pedido: um clawback só na rede; o outro é recusado (em andamento); saldo baixa UMA vez; 1 evento', async () => {
    const r = await Promise.allSettled([executarClawback(IN), executarClawback(IN)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const ko = r.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ko?.reason).toMatchObject({ code: 'PEDIDO_EM_ANDAMENTO' });
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
    expect(await db.eventoAudit.count({ where: { acao: 'CLAWBACK_EXECUTADO' } })).toBe(1);
  });

  it('5 envios simultâneos: ainda um clawback só', async () => {
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => executarClawback(IN)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
  });

  it('depois de concluído, o mesmo pedido devolve o resultado do 1º (idempotente) e o saldo não baixa de novo', async () => {
    const a = await executarClawback(IN);
    const b = await executarClawback(IN);
    expect(b).toMatchObject({ txHash: a.txHash, fundamentoTxHash: a.fundamentoTxHash, payloadHash: a.payloadHash, idempotente: true });
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
  });

  it('registro falha depois do clawback na rede: o mesmo pedido RETOMA e conclui (saldo baixa uma vez; clawback não repete)', async () => {
    st.falhaMemo = true;
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'REGISTRO_PENDENTE', txHash: 'tx_claw_1' });
    expect(await saldo()).toBe(1000);
    const r = await executarClawback(IN);
    expect(r).toMatchObject({ txHash: 'tx_claw_1', idempotente: true });
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
  });

  it('DOIS reenvios simultâneos de um pedido já na rede (onchain): o memo do fundamento vai à rede UMA vez, o saldo baixa uma vez, 1 evento', async () => {
    st.falhaMemo = true;
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'REGISTRO_PENDENTE', txHash: 'tx_claw_1' });
    vi.mocked(registerOnChainHash).mockClear();
    const r = await Promise.allSettled([executarClawback(IN), executarClawback(IN)]);
    expect(vi.mocked(registerOnChainHash)).toHaveBeenCalledTimes(1); // antes: 2 memos na rede, só um ficava no registro
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
    expect(await db.eventoAudit.count({ where: { acao: 'CLAWBACK_EXECUTADO' } })).toBe(1);
    for (const x of r.filter((y): y is PromiseRejectedResult => y.status === 'rejected')) {
      expect(x.reason).toMatchObject({ code: 'PEDIDO_EM_ANDAMENTO' }); // o que perde a corrida é recusado, não conclui de novo
    }
    expect(r.some((x) => x.status === 'fulfilled')).toBe(true);
  });

  /** Deixa o pedido na rede (onchain) com o prazo de conclusão numa idade dada (null = sem prazo). */
  const deixarOnchain = async (idadeDoPrazoMs: number | null) => {
    st.falhaMemo = true;
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'REGISTRO_PENDENTE' });
    const ev = await db.eventoAudit.findFirstOrThrow({ where: { acao: 'CLAWBACK_EXECUTADO' } });
    const g = ev.payloadJson as Record<string, unknown>;
    const { concluindoDesde: _x, ...resto } = g;
    const novo = idadeDoPrazoMs === null ? resto : { ...resto, concluindoDesde: new Date(Date.now() - idadeDoPrazoMs).toISOString() };
    await db.eventoAudit.update({ where: { id: ev.id }, data: { payloadJson: novo as never } });
    vi.mocked(registerOnChainHash).mockClear();
  };

  it('quem já conclui o registro (prazo vigente) segura os outros reenvios: recusados, sem memo na rede e sem baixar o saldo', async () => {
    await deixarOnchain(10_000); // alguém tomou a vez há 10 s
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'PEDIDO_EM_ANDAMENTO' });
    expect(vi.mocked(registerOnChainHash)).not.toHaveBeenCalled();
    expect(await saldo()).toBe(1000);
  });

  it('queda no meio: com o prazo VENCIDO, outro reenvio assume e conclui (uma vez); com a vez solta, também', async () => {
    await deixarOnchain(PRAZO_CONCLUSAO_CLAWBACK_MS + 1_000);
    const r = await executarClawback(IN);
    expect(r).toMatchObject({ txHash: 'tx_claw_1', idempotente: true });
    expect(vi.mocked(registerOnChainHash)).toHaveBeenCalledTimes(1);
    expect(await saldo()).toBe(900);
    expect(st.chamadas).toBe(1);
  });

  it('pedidos diferentes: cada um executa e baixa o saldo', async () => {
    await executarClawback(IN);
    await executarClawback({ ...IN, pedidoId: 'pedido-pg-outro-9876543210' });
    expect(st.chamadas).toBe(2);
    expect(await saldo()).toBe(800);
  });

  it('R1 (cobertura PG): mesmo pedido com OUTRO valor, OUTRA URL ou OUTRO motivo é recusado; só os dados do registro executam', async () => {
    await executarClawback(IN);
    await expect(executarClawback({ ...IN, amount: '500' })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    await expect(executarClawback({ ...IN, fundamentoUrl: 'https://outro.test/falso.pdf' })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    await expect(executarClawback({ ...IN, motivo: 'FRAUDE_DOCUMENTAL' as never })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(900);
  });

  it('R2 (PG): erro sem result_codes → incerto, o saldo NÃO baixa e o mesmo pedido não reexecuta; rejeição com result_codes → failed', async () => {
    st.errosRede = [new Error('ETIMEDOUT')];
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'EXECUCAO_INCERTA' });
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'EXECUCAO_INCERTA' });
    expect(st.chamadas).toBe(1);
    expect(await saldo()).toBe(1000);
    const outro = { ...IN, pedidoId: 'pedido-pg-rejeitado-0123456' };
    st.errosRede = [Object.assign(new Error('rejeitada'), { response: { data: { extras: { result_codes: { transaction: 'tx_failed' } } } } })];
    await expect(executarClawback(outro)).rejects.toMatchObject({ code: 'EXECUCAO_FALHOU' });
    await expect(executarClawback(outro)).rejects.toMatchObject({ code: 'PEDIDO_FALHOU' });
    expect(st.chamadas).toBe(2);
  });
});
