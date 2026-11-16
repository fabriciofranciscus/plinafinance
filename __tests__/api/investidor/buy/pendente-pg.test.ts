/**
 * U2 A-02 com Postgres REAL: GET /api/investidor/buy/pendente devolve a compra pendente DO PRÓPRIO investidor, a mais recente,
 * sem ordem morta nem quote já consumido. Mock só da autenticação (o banco, o filtro e os relacionamentos são de verdade).
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db (só host local; nunca o Neon).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('local apenas');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
const auth = vi.hoisted(() => ({ quem: 'A' as 'A' | 'B' }));
vi.mock('@/lib/wallet/auth-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/wallet/auth-guard')>()),
  requireInvestidor: async () => ({ investidorId: `inv-${auth.quem}`, privyId: `did:privy:${auth.quem}`, publicKey: `G${auth.quem}`.padEnd(56, 'A') }),
}));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: async () => true }, clientIp: () => '203.0.113.9' }));

import { db } from '@/lib/db';
import { GET } from '@/app/api/investidor/buy/pendente/route';

const LIMPAR = 'TRUNCATE "OnRampOrder", "Quote", "Investidor" RESTART IDENTITY CASCADE';
let n = 0;
const investidor = (x: 'A' | 'B') =>
  db.investidor.create({ data: { id: `inv-${x}`, nome: `Investidor ${x}`, email: `${x}@exemplo.test`, publicKey: `G${x}`.padEnd(56, 'A') } });
/** Cria Quote + OnRampOrder; `quando` ordena por criadoEm. */
async function compra(inv: 'A' | 'B', o: { status?: string; consumido?: boolean; submit?: string; cb?: string; claim?: string; quando: number; atualizado?: Date }) {
  n += 1;
  await db.quote.create({
    data: {
      id: `q-${inv}-${n}`, investidorId: `inv-${inv}`, fromCurrency: 'BRL', fromAmount: '300.00', toCurrency: 'TESOURO', toAmount: '307.1234567',
      exchangeRate: '1', fee: '0', expiresAt: new Date('2026-11-16T10:02:00Z'), classe: 'SENIOR',
      ...(o.consumido ? { consumedAt: new Date() } : {}), ...(o.submit ? { submitXdrHash: o.submit } : {}),
    },
  });
  return db.onRampOrder.create({
    data: {
      id: `or-${inv}-${n}`, quoteId: `q-${inv}-${n}`, investidorId: `inv-${inv}`, status: o.status ?? 'pending',
      stellarClaimableBalanceId: o.cb ?? null, claimTxHash: o.claim ?? null, criadoEm: new Date(Date.UTC(2026, 10, 16, 10, 0, o.quando)),
      ...(o.atualizado ? { atualizadoEm: o.atualizado } : {}),
    },
  });
}
const pendente = async (quem: 'A' | 'B') => {
  auth.quem = quem;
  const r = await GET(new Request('http://x/api/investidor/buy/pendente', { headers: { authorization: 'Bearer t' } }));
  expect(r.status).toBe(200);
  return (await r.json()).data.pendente as null | { fase: string; atrasada: boolean; desde: string | null; limiteSegundos: number; onRamp: { orderId: string }; quote: { quoteId: string } };
};

describe.skipIf(!PG)('/api/investidor/buy/pendente (Postgres real)', () => {
  beforeEach(async () => {
    await db.$executeRawUnsafe(LIMPAR);
    await investidor('A');
    await investidor('B');
  });
  afterAll(async () => {
    await db.$executeRawUnsafe(LIMPAR);
    await db.$disconnect();
  });

  it('sem compra → null', async () => {
    expect(await pendente('A')).toBeNull();
  });

  it('o caso do achado: ordem liquidada, claim feito, swap não feito → concluir_swap com os ids certos', async () => {
    const o = await compra('A', { status: 'completed', cb: 'cb', claim: 'claimtx', quando: 1 });
    const p = await pendente('A');
    expect(p?.fase).toBe('concluir_swap');
    expect(p?.onRamp.orderId).toBe(o.id);
    expect(p?.quote.quoteId).toBe(o.quoteId);
  });

  it('é SÓ do dono: o investidor B nunca vê a compra do A', async () => {
    await compra('A', { status: 'completed', cb: 'cb', claim: 'c', quando: 1 });
    expect(await pendente('B')).toBeNull();
  });

  it('com várias, devolve a MAIS RECENTE não concluída', async () => {
    await compra('A', { status: 'pending', quando: 1 });
    const nova = await compra('A', { status: 'processing', cb: 'cb', quando: 30 });
    await compra('A', { status: 'pending', quando: 10 });
    expect((await pendente('A'))?.onRamp.orderId).toBe(nova.id);
  });

  it('compra com swap já concluído (quote consumido) não volta; a anterior pendente passa a valer', async () => {
    const velha = await compra('A', { status: 'completed', cb: 'cb', claim: 'c', quando: 1 });
    await compra('A', { status: 'completed', cb: 'cb', claim: 'c', consumido: true, quando: 50 });
    expect((await pendente('A'))?.onRamp.orderId).toBe(velha.id);
  });

  it.each(['failed', 'expired', 'cancelled', 'refunded'])('ordem %s nunca é oferecida, mesmo sendo a mais recente', async (status) => {
    const boa = await compra('A', { status: 'pending', quando: 1 });
    await compra('A', { status, quando: 50 });
    expect((await pendente('A'))?.onRamp.orderId).toBe(boa.id);
  });

  it('swap já enviado e não escriturado → em_conferencia (a fase NÃO vira concluir_swap)', async () => {
    await compra('A', { status: 'completed', cb: 'cb', claim: 'c', submit: 'a'.repeat(64), quando: 1 });
    expect((await pendente('A'))?.fase).toBe('em_conferencia');
  });

  it.each([
    [{ status: 'pending' }, 'aguardando_pagamento'],
    [{ status: 'processing' }, 'liquidando'],
    [{ status: 'processing', cb: 'cb' }, 'resgatar_tesouro'],
    [{ status: 'completed', cb: 'cb' }, 'resgatar_tesouro'],
  ] as const)('%j → %s', async (o, fase) => {
    await compra('A', { ...o, quando: 1 });
    expect((await pendente('A'))?.fase).toBe(fase);
  });

  it('A-09 (Postgres real): processing sem claimable há 10 min → atrasada, com desde = atualizadoEm; há 1 min → não; pending antiga → nunca', async () => {
    const velho = new Date(Date.now() - 600_000);
    await compra('A', { status: 'processing', quando: 1, atualizado: velho });
    const atrasada = await pendente('A');
    expect(atrasada).toMatchObject({ fase: 'liquidando', atrasada: true, limiteSegundos: 180, desde: velho.toISOString() });

    await db.onRampOrder.updateMany({ where: { investidorId: 'inv-A' }, data: { atualizadoEm: new Date(Date.now() - 60_000) } });
    expect((await pendente('A'))?.atrasada).toBe(false);

    await db.onRampOrder.updateMany({ where: { investidorId: 'inv-A' }, data: { status: 'pending', atualizadoEm: new Date(Date.now() - 6 * 3600_000) } });
    const p = await pendente('A');
    expect(p).toMatchObject({ fase: 'aguardando_pagamento', atrasada: false, desde: null });
  });

  it('A-09: o claimable balance emitido tira a ordem do atraso (a tela segue para o claim)', async () => {
    await compra('A', { status: 'processing', cb: 'cb', quando: 1, atualizado: new Date(Date.now() - 6 * 3600_000) });
    expect(await pendente('A')).toMatchObject({ fase: 'resgatar_tesouro', atrasada: false, desde: null });
  });
});

