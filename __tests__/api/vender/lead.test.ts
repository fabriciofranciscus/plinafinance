import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ checkBotId: vi.fn(), consume: vi.fn(), capturar: vi.fn() }));
vi.mock('botid/server', () => ({ checkBotId: m.checkBotId }));
vi.mock('@/lib/rate-limit/config', () => ({ leadLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/services/originacao', () => ({ capturarLead: m.capturar }));
// withPessoaAuth: entrega um usuário já autenticado (a autenticação em si tem teste próprio).
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: { user: unknown }) => unknown) => (req: Request) =>
    h(req, { user: { pessoaId: 'p_1', kycAprovado: true, nome: 'Ana', email: 'ana@exemplo.test', privyId: 'did:privy:1' } }),
}));

import { POST } from '@/app/api/vender/lead/route';

const req = (body: object) =>
  new Request('http://x/api/vender/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const OK = { consentimentoLgpd: true };

beforeEach(() => {
  delete process.env.BOTID_ENFORCE;
  m.checkBotId.mockReset().mockResolvedValue({ isBot: false });
  m.consume.mockReset().mockResolvedValue(true);
  m.capturar.mockReset().mockResolvedValue({ leadId: 'l_1' });
});

describe('POST /api/vender/lead — BotID atrás de flag (hotfix 14/11)', () => {
  it('padrão (flag ausente): bot → 403 antes do rate limit; humano passa', async () => {
    m.checkBotId.mockResolvedValue({ isBot: true });
    expect((await POST(req(OK))).status).toBe(403);
    expect(m.capturar).not.toHaveBeenCalled();
    expect(m.consume).not.toHaveBeenCalled();
    m.checkBotId.mockResolvedValue({ isBot: false });
    expect((await POST(req(OK))).status).toBe(200);
    expect(m.checkBotId).toHaveBeenCalledWith({ advancedOptions: { extraAllowedHosts: ['www.plina.finance'] } });
  });

  it("BOTID_ENFORCE='false': NÃO chama o BotID (o desafio que prendia o POST) e a requisição segue", async () => {
    process.env.BOTID_ENFORCE = 'false';
    m.checkBotId.mockResolvedValue({ isBot: true });
    const r = await POST(req(OK));
    expect(r.status).toBe(200);
    expect(m.checkBotId).not.toHaveBeenCalled();
    expect(m.capturar).toHaveBeenCalledOnce();
  });

  it("com 'false' o RATE LIMIT segue valendo (429) e o corpo segue validado estrito (400)", async () => {
    process.env.BOTID_ENFORCE = 'false';
    m.consume.mockResolvedValue(false);
    expect((await POST(req(OK))).status).toBe(429);
    m.consume.mockResolvedValue(true);
    expect((await POST(req({ ...OK, extra: 1 }))).status).toBe(400);
    expect((await POST(req({ consentimentoLgpd: false }))).status).toBe(400);
    expect(m.capturar).not.toHaveBeenCalled();
  });

  it("valor diferente de 'false' ('FALSE', '0') continua checando o BotID (fail-closed)", async () => {
    for (const v of ['FALSE', '0', '']) {
      process.env.BOTID_ENFORCE = v;
      m.checkBotId.mockResolvedValue({ isBot: true });
      expect((await POST(req(OK))).status).toBe(403);
    }
    expect(m.capturar).not.toHaveBeenCalled();
  });
});
