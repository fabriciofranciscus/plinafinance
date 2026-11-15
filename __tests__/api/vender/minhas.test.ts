import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  findMany: vi.fn(), consume: vi.fn(),
  user: { pessoaId: 'p_1' as string | null, kycAprovado: false, nome: 'Ana Souza', email: 'ana@exemplo.test', privyId: 'did:privy:1' },
  auth401: false,
}));
vi.mock('@/lib/db', () => ({ db: { leadVendedor: { findMany: m.findMany } } }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: { user: unknown }) => Promise<Response>) => async (req: Request) => {
    if (m.auth401) return Response.json({ error: 'token Privy ausente' }, { status: 401 });
    return h(req, { user: m.user });
  },
}));

import { GET } from '@/app/api/vender/minhas/route';

const get = () => GET(new Request('http://x/api/vender/minhas'));
const D = (v: string) => new Prisma.Decimal(v);
const lead = (over: Record<string, unknown> = {}) => ({
  id: 'lead_1', status: 'OFERTA_ENVIADA',
  criadoEm: new Date('2026-11-14T10:00:00Z'), atualizadoEm: new Date('2026-11-14T11:00:00Z'),
  ofertas: [{ status: 'ENVIADA', tipoBem: 'VEICULO', valorCarta: D('50000'), valorLiquidoVendedor: D('30000.5'), validade: new Date('2026-11-16T10:00:00Z') }],
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.auth401 = false;
  m.user = { pessoaId: 'p_1', kycAprovado: false, nome: 'Ana Souza', email: 'ana@exemplo.test', privyId: 'did:privy:1' };
  m.consume.mockReset().mockResolvedValue(true);
  m.findMany.mockReset().mockResolvedValue([lead()]);
});

describe('GET /api/vender/minhas', () => {
  it('sem token → 401 e nada é consultado', async () => {
    m.auth401 = true;
    expect((await get()).status).toBe(401);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('lista SÓ os leads da Pessoa da sessão (where pessoaId), do mais novo ao mais antigo, até 50', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const arg = m.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ pessoaId: 'p_1' });
    expect(arg.orderBy).toEqual({ criadoEm: 'desc' });
    expect(arg.take).toBe(50);
  });

  it('formato do contrato: id, status, etapa, encerrado/concluido, datas ISO e oferta com valores em string de 2 casas', async () => {
    const { solicitacoes } = await (await get()).json();
    expect(solicitacoes).toEqual([
      {
        id: 'lead_1', status: 'OFERTA_ENVIADA', etapa: expect.any(Number), encerrado: false, concluido: false,
        criadoEm: '2026-11-14T10:00:00.000Z', atualizadoEm: '2026-11-14T11:00:00.000Z',
        oferta: { status: 'ENVIADA', tipoBem: 'VEICULO', valorCarta: '50000.00', valorLiquido: '30000.50', validade: '2026-11-16T10:00:00.000Z' },
      },
    ]);
  });

  it('SEM PII: o select não pede nome, e-mail, telefone, CPF nem administradora, e a resposta não os contém', async () => {
    m.findMany.mockResolvedValue([lead({ nome: 'Ana Souza', email: 'ana@exemplo.test', telefone: '1199', cpf: '12345678909' })]);
    const r = await get();
    const arg = m.findMany.mock.calls[0][0];
    for (const campo of ['nome', 'email', 'telefone', 'cpf']) expect(arg.select[campo]).toBeUndefined();
    expect(Object.keys(arg.select.ofertas.select)).not.toContain('administradora');
    const corpo = JSON.stringify(await r.json());
    expect(corpo).not.toMatch(/Ana Souza|ana@exemplo|1199|12345678909|privy/);
  });

  it('lead sem oferta → oferta null; PERDIDO → encerrado; COTA_INCORPORADA/PIX_EXECUTADO → concluido', async () => {
    m.findMany.mockResolvedValue([
      lead({ id: 'a', status: 'NOVO', ofertas: [] }),
      lead({ id: 'b', status: 'PERDIDO' }),
      lead({ id: 'c', status: 'COTA_INCORPORADA' }),
      lead({ id: 'd', status: 'PIX_EXECUTADO' }),
    ]);
    const { solicitacoes } = await (await get()).json();
    const por = Object.fromEntries(solicitacoes.map((s: { id: string }) => [s.id, s]));
    expect(por.a.oferta).toBeNull();
    expect(por.b).toMatchObject({ encerrado: true, concluido: false });
    expect(por.c).toMatchObject({ encerrado: false, concluido: true });
    expect(por.d).toMatchObject({ encerrado: false, concluido: true });
  });

  it('Pessoa ainda não criada (pré-KYC): 200 com lista vazia, sem consultar o banco', async () => {
    m.user = { ...m.user, pessoaId: null };
    const r = await get();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ solicitacoes: [] });
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('rate limit estourado → 429, sem consultar', async () => {
    m.consume.mockResolvedValue(false);
    expect((await get()).status).toBe(429);
    expect(m.consume).toHaveBeenCalledWith('203.0.113.9');
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('erro do banco → 500 fixo, sem vazar a causa', async () => {
    m.findMany.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('SEGREDO');
  });

  it('um usuário só vê o que a consulta devolve para a SUA pessoaId (a rota nunca usa id vindo da requisição)', async () => {
    m.user = { ...m.user, pessoaId: 'p_2' };
    await GET(new Request('http://x/api/vender/minhas?pessoaId=p_1&leadId=lead_9'));
    expect(m.findMany.mock.calls[0][0].where).toEqual({ pessoaId: 'p_2' });
  });
});
