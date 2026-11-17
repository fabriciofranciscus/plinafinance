/**
 * Trava por ordem da consulta de status ao anchor (U2/onramp-status), no Postgres REAL. A reserva é uma instrução SQL atômica
 * (`UPDATE ... WHERE statusConsultadoEm nulo ou mais velho que N s`, relógio do BANCO): exatamente 1 de N chamadas simultâneas ganha.
 * Só roda com um Postgres descartável em TEST_PG_URL (localhost, migrations aplicadas); sem a variável é pulado.
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

import { db } from '@/lib/db';
import { ONRAMP_CONSULTA_MIN_INTERVALO_S, STATUS_TERMINAIS_ONRAMP, reservarConsultaDeStatus } from '@/lib/services/onramp-status-reserva';

const N = ONRAMP_CONSULTA_MIN_INTERVALO_S;
const mkOrdem = async (id: string, over: Record<string, unknown> = {}) => {
  await db.quote.create({ data: { id: `q_${id}`, investidorId: 'inv_t', fromCurrency: 'BRL', fromAmount: '10', toCurrency: 'TESOURO', toAmount: '8', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 60_000) } });
  await db.onRampOrder.create({ data: { id, quoteId: `q_${id}`, investidorId: 'inv_t', status: 'processing', ...over } as never });
};
const consultadoEm = async (id: string) => (await db.onRampOrder.findUniqueOrThrow({ where: { id } })).statusConsultadoEm;
/** Recua a marca no BANCO (mesma convenção da coluna: timestamp UTC sem fuso). */
const recuar = (id: string, seg: number) =>
  db.$executeRaw`UPDATE "OnRampOrder" SET "statusConsultadoEm" = (now() AT TIME ZONE 'UTC') - (${seg} * interval '1 second') WHERE id = ${id}`;

describe.skipIf(!PG)('onramp/status — reserva por ordem no Postgres real', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "OnRampOrder","Quote","Investidor" RESTART IDENTITY CASCADE');
    await db.investidor.create({ data: { id: 'inv_t', nome: 'Inv', email: 'inv@exemplo.test', publicKey: 'G' + 'A'.repeat(55), privyId: 'did:privy:t' } });
  });

  it('primeira vez (coluna nula): ganha e grava a marca', async () => {
    await mkOrdem('o1');
    expect(await consultadoEm('o1')).toBeNull();
    expect(await reservarConsultaDeStatus('o1')).toBe(true);
    expect(await consultadoEm('o1')).not.toBeNull();
  });

  it('20 reservas CONCORRENTES na mesma ordem: exatamente 1 ganha', async () => {
    await mkOrdem('o1');
    const r = await Promise.all(Array.from({ length: 20 }, () => reservarConsultaDeStatus('o1')));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('dentro de N segundos: ninguém ganha; passados N+1 s: 1 ganha de novo', async () => {
    await mkOrdem('o1');
    expect(await reservarConsultaDeStatus('o1')).toBe(true);
    expect(await reservarConsultaDeStatus('o1')).toBe(false);
    await recuar('o1', N - 2);
    expect(await reservarConsultaDeStatus('o1')).toBe(false);
    await recuar('o1', N + 1);
    expect(await reservarConsultaDeStatus('o1')).toBe(true);
  });

  it('ordem terminal nunca é reservada: TODO status da lista única (a mesma que a rota usa)', async () => {
    expect([...STATUS_TERMINAIS_ONRAMP].sort()).toEqual(['cancelled', 'completed', 'expired', 'failed', 'refunded']); // mudar a lista exige mudar aqui
    for (const s of STATUS_TERMINAIS_ONRAMP) {
      await mkOrdem(`t_${s}`, { status: s });
      expect(await reservarConsultaDeStatus(`t_${s}`), s).toBe(false);
    }
  });

  it('ordem inexistente: não ganha', async () => {
    expect(await reservarConsultaDeStatus('nao-existe')).toBe(false);
  });

  it('ordens diferentes são independentes: uma reserva não segura a outra', async () => {
    await mkOrdem('a'); await mkOrdem('b');
    const r = await Promise.all([reservarConsultaDeStatus('a'), reservarConsultaDeStatus('b'), reservarConsultaDeStatus('a'), reservarConsultaDeStatus('b')]);
    expect(r.filter(Boolean)).toHaveLength(2);
  });

  it('a reserva NÃO mexe em atualizadoEm: o "desde quando espera" do A-09 continua valendo (SQL cru, não @updatedAt)', async () => {
    await mkOrdem('o1');
    const antes = (await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm;
    await new Promise((r) => setTimeout(r, 30));
    expect(await reservarConsultaDeStatus('o1')).toBe(true);
    const depois = (await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm;
    expect(depois.getTime()).toBe(antes.getTime());
  });

  it('usa o relógio do banco: uma marca no FUTURO (relógio de instância adiantado) segura a ordem', async () => {
    await mkOrdem('o1');
    await recuar('o1', -3600); // 1 h à frente
    expect(await reservarConsultaDeStatus('o1')).toBe(false);
  });
});
