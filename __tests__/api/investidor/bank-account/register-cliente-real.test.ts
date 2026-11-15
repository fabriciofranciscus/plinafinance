/**
 * POST /api/investidor/bank-account/register com o EtherfuseClient REAL (só o `fetch` é simulado): prova que a rota cumpre a
 * assinatura de verdade do `getKycUrl` (4º argumento { email, displayName? }). O teste antigo mocka o cliente inteiro e deixou
 * passar o bug em produção (500 MISSING_EMAIL para todo investidor sem conta Pix para reaproveitar; Vera, 15/11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), audit: vi.fn(), fetch: vi.fn(),
  user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GABC', email: 'inv@exemplo.test', etherfuseCustomerId: 'cust_1' },
}));
vi.mock('@/lib/wallet/auth-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/wallet/auth-guard')>()),
  requireInvestidor: vi.fn(async () => m.user),
}));
vi.mock('@/lib/db', () => ({
  db: {
    investidor: { findUnique: m.findUnique, update: m.update },
    eventoAudit: { create: m.audit },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ investidor: { update: m.update }, eventoAudit: { create: m.audit } }),
  },
}));

import { POST } from '@/app/api/investidor/bank-account/register/route';

const BODY = { pixKey: '52998224725', pixKeyType: 'cpf', cpf: '52998224725', firstName: 'Ana', lastName: 'Souza' };
const post = () => POST(new Request('http://x/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY) }));
const inv = (over: Record<string, unknown> = {}) => ({
  id: 'inv_1', publicKey: 'GABC', etherfuseCustomerId: 'cust_1', etherfuseBankAccountId: null, nome: 'Ana Souza', email: 'inv@exemplo.test', ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Respostas por caminho do upstream. */
type Rotas = { contas?: () => Response; onboarding?: () => Response; registro?: () => Response };
function upstream(r: Rotas = {}) {
  m.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/bank-accounts')) return (r.contas ?? (() => json(200, { items: [] })))();
    if (url.endsWith('/ramp/onboarding-url')) return (r.onboarding ?? (() => json(200, { presigned_url: 'https://sand.etherfuse.test/onb?sig=1' })))();
    if (url.endsWith('/ramp/bank-account')) return (r.registro ?? (() => json(200, { bankAccountId: 'bank-1', status: 'active' })))();
    return json(404, {});
  });
}
const chamadas = (fim: string) => m.fetch.mock.calls.filter((c) => String(c[0]).endsWith(fim));

beforeEach(() => {
  process.env.ETHERFUSE_API_KEY = 'test-key';
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', m.fetch);
  m.fetch.mockReset();
  m.update.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue(undefined);
  m.user = { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: 'GABC', email: 'inv@exemplo.test', etherfuseCustomerId: 'cust_1' };
  m.findUnique.mockReset().mockResolvedValue(inv());
  upstream();
});

describe('register com o cliente Etherfuse real', () => {
  it('investidor NOVO (sem conta Pix para reaproveitar): 200; o onboarding-url leva userInfo.email e displayName', async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ bankAccountId: 'bank-1', status: 'active' });
    const corpo = JSON.parse(String(chamadas('/ramp/onboarding-url')[0]![1].body));
    expect(corpo).toMatchObject({ customerId: 'cust_1', publicKey: 'GABC', accountType: 'personal', userInfo: { email: 'inv@exemplo.test', displayName: 'Ana Souza' } });
    expect(chamadas('/ramp/bank-account')).toHaveLength(1);
  });

  it('o e-mail vem da sessão (Pessoa); sem ele, do espelho do Investidor', async () => {
    m.user.email = '';
    m.findUnique.mockResolvedValue(inv({ email: 'espelho@exemplo.test' }));
    expect((await post()).status).toBe(200);
    expect(JSON.parse(String(chamadas('/ramp/onboarding-url')[0]![1].body)).userInfo.email).toBe('espelho@exemplo.test');
  });

  it('sem e-mail em lugar nenhum: 409 CONFLICT claro, sem chamar o onboarding nem o registro', async () => {
    m.user.email = '';
    m.findUnique.mockResolvedValue(inv({ email: '' }));
    const r = await post();
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('CONFLICT');
    expect(chamadas('/ramp/onboarding-url')).toHaveLength(0);
    expect(chamadas('/ramp/bank-account')).toHaveLength(0);
  });

  it('reuso continua: conta Pix já existe → 200 idempotente, sem onboarding nem registro', async () => {
    upstream({ contas: () => json(200, { items: [{ bankAccountId: 'bank-velha', pixKey: '529***', createdAt: '' }] }) });
    const r = await post();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ bankAccountId: 'bank-velha', idempotent: true });
    expect(chamadas('/ramp/onboarding-url')).toHaveLength(0);
  });

  it('upstream recusa o onboarding (4xx) → 422 com mensagem FIXA; nada do texto do upstream vai ao cliente', async () => {
    upstream({ onboarding: () => json(400, { error: { code: 'INVALID_USER_INFO', message: 'email inv@exemplo.test rejected by upstream' } }) });
    const r = await post();
    const corpo = await r.json();
    expect(r.status).toBe(422);
    expect(corpo.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(corpo)).not.toMatch(/exemplo\.test|upstream|INVALID_USER_INFO/);
    expect(chamadas('/ramp/bank-account')).toHaveLength(0);
  });

  it('upstream recusa o registro (4xx) → 422 fixo; falha do upstream (5xx) → 502 ETHERFUSE_ERROR fixo (nunca 500 INTERNAL)', async () => {
    upstream({ registro: () => json(422, { error: { code: 'INVALID_PIX_KEY', message: 'chave 52998224725 inválida' } }) });
    const quatro = await post();
    expect(quatro.status).toBe(422);
    expect(JSON.stringify(await quatro.json())).not.toMatch(/52998224725|INVALID_PIX_KEY/);
    m.findUnique.mockResolvedValue(inv());
    upstream({ registro: () => json(503, { error: { code: 'DOWN', message: 'segredo interno' } }) });
    const cinco = await post();
    expect(cinco.status).toBe(502);
    const corpo = await cinco.json();
    expect(corpo.error.code).toBe('ETHERFUSE_ERROR');
    expect(JSON.stringify(corpo)).not.toMatch(/segredo interno|DOWN/);
  });

  it('erro que NÃO é do anchor (ex.: banco) continua 500 INTERNAL, sem vazar a causa', async () => {
    m.update.mockRejectedValue(new Error('conexão com senha xyz caiu'));
    const r = await post();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('xyz');
  });
});
