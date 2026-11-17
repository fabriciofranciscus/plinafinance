import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ find: vi.fn(), consume: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { onRampOrder: { findFirst: m.find } } }));
vi.mock('@/lib/wallet/auth-guard', async (orig) => ({ ...(await orig<typeof import('@/lib/wallet/auth-guard')>()), requireInvestidor: m.auth }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));

import { GET } from '@/app/api/investidor/buy/pendente/route';

const ordem = (over: Record<string, unknown> = {}, quote: Record<string, unknown> = {}) => ({
  id: 'or-1',
  status: 'completed',
  paymentInstructionsJson: { pixCode: 'pix-code', beneficiary: 'Plina Sandbox' },
  stellarTxHash: 'tx-onramp',
  stellarClaimableBalanceId: 'cb-1',
  claimTxHash: 'claim-tx',
  criadoEm: new Date('2026-11-16T10:00:00Z'),
  quote: {
    id: 'q-1',
    fromAmount: new Prisma.Decimal('300.00'),
    toAmount: new Prisma.Decimal('307.1234567'),
    plinarfAmount: new Prisma.Decimal('307.1234567'),
    navPorTokenNaCotacao: new Prisma.Decimal('1'),
    exchangeRate: '1.0237',
    fee: '0',
    expiresAt: new Date('2026-11-16T10:02:00Z'),
    submitXdrHash: null,
    consumedAt: null,
    ...quote,
  },
  ...over,
});
const req = () => new Request('http://x/api/investidor/buy/pendente', { headers: { authorization: 'Bearer t' } });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.consume.mockReset().mockResolvedValue(true);
  m.auth.mockReset().mockResolvedValue({ investidorId: 'inv_1', privyId: 'did:privy:a', publicKey: 'GABC' });
  m.find.mockReset().mockResolvedValue(ordem());
});

describe('GET /api/investidor/buy/pendente', () => {
  it('devolve a compra pendente nos formatos da tela, com a fase e os valores em string', async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    const { data } = await r.json();
    expect(data.pendente.fase).toBe('concluir_swap');
    expect(data.pendente.quote).toEqual({
      quoteId: 'q-1',
      fromAmount: '300',
      toAmount: '307.1234567',
      plinarfAmount: '307.1234567',
      navPorTokenNaCotacao: '1.00000000',
      exchangeRate: '1.0237',
      fee: '0',
      expiresAt: '2026-11-16T10:02:00.000Z',
    });
    expect(data.pendente.onRamp).toEqual({
      orderId: 'or-1',
      status: 'completed',
      paymentInstructions: { pixCode: 'pix-code', beneficiary: 'Plina Sandbox' },
      mock: false,
      stellarTxHash: 'tx-onramp',
      stellarClaimableBalanceId: 'cb-1',
      claimTxHash: 'claim-tx',
    });
  });

  it('a consulta é SÓ do investidor da sessão, exclui ordens mortas e quotes já consumidos, e pega a mais recente', async () => {
    await GET(req());
    const arg = m.find.mock.calls[0]![0];
    expect(arg.where.investidorId).toBe('inv_1');
    expect(arg.where.status.notIn).toEqual(['failed', 'expired', 'cancelled', 'refunded']);
    expect(arg.where.quote).toEqual({ consumedAt: null });
    expect(arg.orderBy).toEqual({ criadoEm: 'desc' });
  });

  it('sem ordem pendente → { pendente: null }', async () => {
    m.find.mockResolvedValue(null);
    expect((await (await GET(req())).json()).data).toEqual({ pendente: null });
  });

  it('ordem sem fase retomável (status desconhecido) → { pendente: null }', async () => {
    m.find.mockResolvedValue(ordem({ status: 'status-novo' }));
    expect((await (await GET(req())).json()).data).toEqual({ pendente: null });
  });

  it('swap em curso → fase em_conferencia', async () => {
    m.find.mockResolvedValue(ordem({}, { submitXdrHash: 'x'.repeat(64) }));
    expect((await (await GET(req())).json()).data.pendente.fase).toBe('em_conferencia');
  });

  it('ordem mock é sinalizada como mock (a tela sandbox continua funcionando)', async () => {
    m.find.mockResolvedValue(ordem({ status: 'pending', paymentInstructionsJson: { __mock: true, pixCode: 'mock' }, stellarClaimableBalanceId: null, claimTxHash: null }));
    const { data } = await (await GET(req())).json();
    expect(data.pendente.fase).toBe('aguardando_pagamento');
    expect(data.pendente.onRamp.mock).toBe(true);
  });

  it('cotação sem preço de emissão (legado) → campos nulos, sem quebrar', async () => {
    m.find.mockResolvedValue(ordem({}, { plinarfAmount: null, navPorTokenNaCotacao: null }));
    const { data } = await (await GET(req())).json();
    expect(data.pendente.quote.plinarfAmount).toBeNull();
    expect(data.pendente.quote.navPorTokenNaCotacao).toBeNull();
  });

  it('A-09: fase liquidando atrasada (processing sem claimable há 10 min) → pendente.atrasada true, com desde; fora disso false', async () => {
    const velha = new Date(Date.now() - 600_000);
    m.find.mockResolvedValue(ordem({ status: 'processing', stellarClaimableBalanceId: null, claimTxHash: null, atualizadoEm: velha }));
    const { data } = await (await GET(req())).json();
    expect(data.pendente.fase).toBe('liquidando');
    expect(data.pendente.atrasada).toBe(true);
    expect(data.pendente.desde).toBe(velha.toISOString());
    m.find.mockResolvedValue(ordem({ status: 'processing', stellarClaimableBalanceId: null, claimTxHash: null, atualizadoEm: new Date() }));
    expect((await (await GET(req())).json()).data.pendente.atrasada).toBe(false);
    m.find.mockResolvedValue(ordem({ atualizadoEm: new Date(Date.now() - 600_000) })); // completed com claim: nunca
    expect((await (await GET(req())).json()).data.pendente.atrasada).toBe(false);
  });

  it('sem sessão → 401 e o banco não é consultado', async () => {
    const { AuthError } = await import('@/lib/wallet/auth-guard');
    m.auth.mockRejectedValue(new AuthError('token Privy ausente', 401));
    const r = await GET(req());
    expect(r.status).toBe(401);
    expect(m.find).not.toHaveBeenCalled();
  });

  it('rate limit → 429 sem consultar o banco', async () => {
    m.consume.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(429);
    expect(m.find).not.toHaveBeenCalled();
  });

  it('falha do banco → 500 com mensagem FIXA (sem vazar a causa)', async () => {
    m.find.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await GET(req());
    expect(r.status).toBe(500);
    expect(await r.text()).not.toMatch(/SEGREDO|postgresql/);
  });
});
