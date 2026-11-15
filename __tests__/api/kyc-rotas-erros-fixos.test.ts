/**
 * /api/conta/kyc e /api/comprar/kyc: nenhum err.message cru vai ao cliente (Argus, MEDIUM, regra do #100).
 * 500 → "erro interno" fixo; AnchorError 4xx → 422 / outro → 502 com mensagem fixa; ApiError (ex.: CPF inválido) → status e mensagem
 * FIXOS do app. Só as duas rotas; o fluxo de KYC não muda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ensure: vi.fn(), resolver: vi.fn(), audit: vi.fn(), consume: vi.fn() }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: { user: unknown }) => Promise<Response>) => (req: Request) =>
    h(req, { user: { privyId: 'did:privy:abc', email: 'ana@exemplo.test', nome: 'Ana Souza', pessoaId: 'p1' } }),
}));
vi.mock('@/lib/services/pessoa', () => ({ ensureKycForPessoa: m.ensure }));
vi.mock('@/lib/services/realizacao', () => ({ resolverLeadCompradorPorPessoa: m.resolver }));
vi.mock('@/lib/db', () => ({ db: { eventoAudit: { create: m.audit } } }));
vi.mock('@/lib/rate-limit/config', () => ({ sensitiveAuthLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));

import { POST as conta } from '@/app/api/conta/kyc/route';
import { POST as comprar } from '@/app/api/comprar/kyc/route';
import { ApiError } from '@/lib/api/errors';
import { AnchorError } from '@/lib/anchors/types';

const post = (rota: typeof conta, body: object) =>
  rota(new Request('http://x/kyc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const ROTAS = [
  ['conta/kyc', conta, { nome: 'Ana Souza', cpf: '52998224725', papel: 'INVESTIDOR' }],
  ['comprar/kyc', comprar, { nome: 'Ana Souza', cpf: '52998224725' }],
] as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.consume.mockReset().mockResolvedValue(true);
  m.ensure.mockReset().mockResolvedValue({ pessoaId: 'p1', kycAprovado: true, kycStatus: 'APROVADO', papeis: ['INVESTIDOR'], etherfuseBankAccountId: null });
  m.resolver.mockReset().mockResolvedValue(undefined);
  m.audit.mockReset().mockResolvedValue({});
});

describe.each(ROTAS)('%s — erros com mensagem fixa', (_nome, rota, body) => {
  it('sucesso segue igual (200)', async () => {
    expect((await post(rota, body)).status).toBe(200);
  });

  it('erro inesperado (ex.: Prisma com valores na mensagem) → 500 fixo "erro interno"; nada do texto vai ao cliente', async () => {
    m.ensure.mockRejectedValue(new Error('Invalid `prisma.pessoa.upsert()`: { email: "ana@exemplo.test", cpf: "52998224725" }'));
    const r = await post(rota, body);
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(JSON.parse(t)).toEqual({ error: 'erro interno' });
    expect(t).not.toMatch(/prisma|exemplo\.test|52998224725/i);
  });

  it('AnchorError 4xx da Etherfuse (texto ecoa dado) → 422 fixo; 5xx → 502 fixo; texto do upstream nunca sai', async () => {
    m.ensure.mockRejectedValueOnce(new AnchorError('Identity para ana@exemplo.test CPF 52998224725 inválida', 'INVALID', 400));
    const quatro = await post(rota, body);
    expect(quatro.status).toBe(422);
    expect(await quatro.text()).not.toMatch(/exemplo\.test|52998224725|Identity/);
    m.ensure.mockRejectedValueOnce(new AnchorError('upstream caiu segredo xyz', 'DOWN', 503));
    const cinco = await post(rota, body);
    expect(cinco.status).toBe(502);
    expect(await cinco.text()).not.toContain('xyz');
  });

  it('ApiError do app (CPF inválido) → o mesmo status (400) e a mensagem FIXA do app, com code', async () => {
    m.ensure.mockRejectedValue(new ApiError('VALIDATION_FAILED', 400, 'cpf inválido (precisa ser um CPF real, válido por módulo 11)'));
    const r = await post(rota, body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'cpf inválido (precisa ser um CPF real, válido por módulo 11)', code: 'VALIDATION_FAILED' });
  });
});
