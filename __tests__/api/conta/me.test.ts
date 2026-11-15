import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ requirePessoa: vi.fn() }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({ requirePessoa: m.requirePessoa }));

import { GET } from '@/app/api/conta/me/route';

const base = { pessoaId: 'p_1', email: 'ana@exemplo.test', kycAprovado: true, kycStatus: 'APROVADO', papeis: ['CEDENTE'] };
const get = () => GET(new Request('http://x/api/conta/me'));

beforeEach(() => {
  m.requirePessoa.mockReset();
});

describe('GET /api/conta/me — o e-mail não é devolvido como nome (pós-cota 15/11)', () => {
  it('nome de verdade segue igual', async () => {
    m.requirePessoa.mockResolvedValue({ ...base, nome: 'Ana Souza' });
    expect((await (await get()).json()).nome).toBe('Ana Souza');
  });
  it.each([['ana@exemplo.test'], ['test-4872@privy.io'], [''], [null]])('Pessoa.nome %j → nome null (a tela não pré-preenche nem exibe o e-mail)', async (nome) => {
    m.requirePessoa.mockResolvedValue({ ...base, nome });
    const corpo = await (await get()).json();
    expect(corpo.nome).toBeNull();
    expect(corpo.email).toBe('ana@exemplo.test'); // o e-mail segue no campo próprio
  });
  it('sem sessão → 401 authenticated:false, como antes', async () => {
    const { AuthError } = await import('@/lib/wallet/auth-guard');
    m.requirePessoa.mockImplementation(async () => {
      throw new AuthError('token ausente', 401);
    });
    const r = await get();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ authenticated: false });
  });
});
