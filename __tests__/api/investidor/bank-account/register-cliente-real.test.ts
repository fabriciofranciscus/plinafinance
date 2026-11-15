/**
 * POST /api/investidor/bank-account/register com o EtherfuseClient REAL (só o `fetch` é simulado): o fluxo atual da Etherfuse
 * (registrar a carteira no customer + POST /ramp/customer/{id}/bank-account com a chave de API), SEM presignedUrl/onboarding-url
 * (descontinuados). O teste antigo mockava o cliente inteiro e deixou passar o bug de produção (Vera, 15/11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const PK = Keypair.random().publicKey();
const m = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), audit: vi.fn(), fetch: vi.fn(),
  user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: '', email: 'inv@exemplo.test', etherfuseCustomerId: 'cust_1' },
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

const PF = { pixKey: '52998224725', pixKeyType: 'cpf', cpf: '52998224725', firstName: 'Ana', lastName: 'Souza' };
const post = (body: object = PF) => POST(new Request('http://x/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const inv = (over: Record<string, unknown> = {}) => ({
  id: 'inv_1', publicKey: PK, etherfuseCustomerId: 'cust_1', etherfuseBankAccountId: null, nome: 'Ana Souza', email: 'inv@exemplo.test', ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Rotas = { contas?: () => Response; carteira?: () => Response; conta?: () => Response };
function upstream(r: Rotas = {}) {
  m.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/bank-accounts')) return (r.contas ?? (() => json(200, { items: [] })))();
    if (url.endsWith('/wallet')) return (r.carteira ?? (() => json(200, { walletId: 'wallet-1', customerId: 'cust_1', publicKey: PK, blockchain: 'stellar' })))();
    if (url.endsWith('/bank-account')) return (r.conta ?? (() => json(201, { bankAccountId: 'bank-1', status: 'active', compliant: true })))();
    return json(404, {});
  });
}
const chamadas = (fim: string) => m.fetch.mock.calls.filter((c) => String(c[0]).endsWith(fim));
const corpo = (c: unknown[]) => JSON.parse(String((c[1] as { body: string }).body));

beforeEach(() => {
  process.env.ETHERFUSE_API_KEY = 'test-key';
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', m.fetch);
  m.fetch.mockReset();
  m.update.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue(undefined);
  m.user = { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: PK, email: 'inv@exemplo.test', etherfuseCustomerId: 'cust_1' };
  m.findUnique.mockReset().mockResolvedValue(inv());
  upstream();
});

describe('register com o cliente Etherfuse real (fluxo atual)', () => {
  it('investidor PF novo: registra a carteira e a conta Pix pela API; NUNCA chama onboarding-url nem /ramp/bank-account (presigned)', async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ bankAccountId: 'bank-1', status: 'active' });
    expect(corpo(chamadas('/ramp/customer/cust_1/wallet')[0]!)).toEqual({ publicKey: PK, blockchain: 'stellar' });
    const conta = corpo(chamadas('/ramp/customer/cust_1/bank-account')[0]!);
    expect(conta.account).toMatchObject({ pixKey: '52998224725', pixKeyType: 'cpf', firstName: 'Ana', lastName: 'Souza', cpf: '52998224725' });
    expect(conta.account.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.fetch.mock.calls.some((c) => /onboarding-url|\/agreements\/|\/ramp\/bank-account$/.test(String(c[0])))).toBe(false);
    // a chave de API vai no cabeçalho
    expect(((chamadas('/bank-account')[0]![1] as { headers: Record<string, string> }).headers).Authorization).toBe('test-key');
  });

  it('PF sem cpf/nome no corpo → 400 antes de qualquer chamada externa', async () => {
    m.fetch.mockClear();
    const r = await post({ pixKey: 'a@b.test', pixKeyType: 'email' });
    expect(r.status).toBe(400);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('reuso continua: conta Pix já existe → 200 idempotente, sem registrar nada', async () => {
    upstream({ contas: () => json(200, { items: [{ bankAccountId: 'bank-velha', pixKey: '529***', createdAt: '' }] }) });
    const r = await post();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ bankAccountId: 'bank-velha', idempotent: true });
    expect(chamadas('/wallet')).toHaveLength(0);
    expect(chamadas('/ramp/customer/cust_1/bank-account')).toHaveLength(0);
  });

  it('fail-closed: se o registro da carteira falha (4xx), a conta NÃO é criada: 422 fixo, sem o texto do upstream', async () => {
    upstream({ carteira: () => json(404, { error: { code: 'NOT_FOUND', message: 'customer de inv@exemplo.test não é da organização' } }) });
    const r = await post();
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).not.toMatch(/exemplo\.test|organização|NOT_FOUND/);
    expect(chamadas('/ramp/customer/cust_1/bank-account')).toHaveLength(0);
  });

  it('upstream recusa a conta (4xx) → 422 fixo; 409 org não aprovada → 422; falha do upstream (5xx) → 502 ETHERFUSE_ERROR (nunca 500)', async () => {
    upstream({ conta: () => json(422, { error: { code: 'INVALID_PIX_KEY', message: 'chave 52998224725 inválida' } }) });
    const quatro = await post();
    expect(quatro.status).toBe(422);
    expect(JSON.stringify(await quatro.json())).not.toMatch(/52998224725|INVALID_PIX_KEY/);
    upstream({ conta: () => json(409, { error: { code: 'ORG_NOT_APPROVED', message: 'org not approved' } }) });
    expect((await post()).status).toBe(422);
    upstream({ conta: () => json(503, { error: { code: 'DOWN', message: 'segredo interno' } }) });
    const cinco = await post();
    expect(cinco.status).toBe(502);
    const c = await cinco.json();
    expect(c.error.code).toBe('ETHERFUSE_ERROR');
    expect(JSON.stringify(c)).not.toMatch(/segredo interno|DOWN/);
  });

  it('resposta do registro de carteira sem walletId → falha fechada (502), nada de conta', async () => {
    upstream({ carteira: () => json(200, { customerId: 'cust_1' }) });
    expect((await post()).status).toBe(502);
    expect(chamadas('/ramp/customer/cust_1/bank-account')).toHaveLength(0);
  });

  it('erro que NÃO é do anchor (banco) continua 500 INTERNAL, sem vazar a causa', async () => {
    m.update.mockRejectedValue(new Error('conexão com senha xyz caiu'));
    const r = await post();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('xyz');
  });
});
