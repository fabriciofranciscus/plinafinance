import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { ApiError } from '@/lib/api/errors';

const USER_PK = Keypair.random().publicKey();
const m = vi.hoisted(() => ({ cotar: vi.fn(), getQuote: vi.fn(), tesouro: vi.fn(), user: { etherfuseCustomerId: 'cust_1' as string | null } }));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: USER_PK, email: 'x@y.z', ...m.user } }),
}));
vi.mock('@/lib/services/resgate', () => ({ cotarResgate: m.cotar }));
vi.mock('@/lib/anchors/etherfuse', () => ({ EtherfuseClient: class { getQuote = m.getQuote; } }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset: m.tesouro }));
process.env.ETHERFUSE_API_KEY = 'test';

import { POST } from '@/app/api/investidor/liquidar/build/route';
import { NAV_INDISPONIVEL_MENSAGEM, NavIndisponivelError } from '@/lib/services/nav-supply';
import { sensitiveAuthLimiter } from '@/lib/rate-limit/config';

const req = (body: object) =>
  new Request('http://x/build', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.3.3.3' }, body: JSON.stringify(body) });
const COTACAO = {
  quoteId: 'q_1', xdr: 'XDR', hashHex: '0xabc', amountPlinarf: '10.0000000', brlEquivalente: '10.00',
  navPorTokenNaCotacao: '1.00000000', expiresAt: '2026-11-11T12:00:00.000Z',
};

beforeEach(async () => {
  await sensitiveAuthLimiter.reset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.user.etherfuseCustomerId = 'cust_1';
  m.cotar.mockReset().mockResolvedValue(COTACAO);
  m.getQuote.mockReset().mockResolvedValue({ exchangeRate: '0.8554' });
  m.tesouro.mockReset().mockResolvedValue({ code: 'TESOURO', issuer: 'GTES' });
});

describe('POST /api/investidor/liquidar/build (E2-6)', () => {
  it('200 com o contrato; o investidor e a taxa vêm da sessão e da Etherfuse, não do body', async () => {
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(COTACAO);
    expect(m.getQuote).toHaveBeenCalledWith(expect.objectContaining({ fromCurrency: 'BRL', toCurrency: 'TESOURO', customerId: 'cust_1', stellarAddress: USER_PK }));
    expect(m.cotar).toHaveBeenCalledWith({
      investidorId: 'inv_1', investorPubkey: USER_PK, amountPlinarf: '10', taxaBrlParaBridge: '0.8554',
      bridgeAsset: { code: 'TESOURO', issuer: 'GTES' },
    });
  });

  it('400 com body antigo (pubkey/amount), campo extra, valor inválido ou zero; sem chamar a Etherfuse', async () => {
    for (const corpo of [
      { pubkey: USER_PK, amount: '10' },
      { amountPlinarf: '10', pubkey: USER_PK },
      { amountPlinarf: '0' },
      { amountPlinarf: '1.00000001' },
      { amountPlinarf: 'abc' },
      {},
    ]) {
      expect((await POST(req(corpo))).status, JSON.stringify(corpo)).toBe(400);
    }
    expect(m.getQuote).not.toHaveBeenCalled();
    expect(m.cotar).not.toHaveBeenCalled();
  });

  it('429 depois de 10 chamadas do mesmo IP em 1 minuto', async () => {
    for (let i = 0; i < 10; i++) await POST(req({ amountPlinarf: '10' }));
    expect((await POST(req({ amountPlinarf: '10' }))).status).toBe(429);
  });

  it('sem cadastro na Etherfuse → 409, sem chamar a Etherfuse', async () => {
    m.user.etherfuseCustomerId = null;
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(409);
    expect(m.getQuote).not.toHaveBeenCalled();
  });

  it('ApiError do serviço (SWAP_EM_CONFERENCIA etc.) → status e { error, code }', async () => {
    m.cotar.mockRejectedValue(new ApiError('SWAP_EM_CONFERENCIA', 409, 'em conferência'));
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'em conferência', code: 'SWAP_EM_CONFERENCIA' });
  });

  it('NAV indisponível → 503 constante, sem a causa', async () => {
    m.cotar.mockRejectedValue(new NavIndisponivelError('EMISSAO_PENDENTE', { cause: new Error('ENOTFOUND db') }));
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toEqual({ error: NAV_INDISPONIVEL_MENSAGEM, code: 'LEDGER_UNAVAILABLE' });
  });

  it('erro comum (Etherfuse fora, banco…) → 500 fixo, sem vazar a causa', async () => {
    m.getQuote.mockRejectedValue(new Error('etherfuse 502 SEGREDO'));
    const r = await POST(req({ amountPlinarf: '10' }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
});
