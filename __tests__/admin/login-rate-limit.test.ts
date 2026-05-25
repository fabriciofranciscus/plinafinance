import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  passwordMatches,
  setAdminCookie,
  headersGet,
} = vi.hoisted(() => ({
  passwordMatches: vi.fn(),
  setAdminCookie: vi.fn(),
  headersGet: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: headersGet }),
  cookies: async () => ({ get: vi.fn(), set: vi.fn() }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // Simula throw do redirect do Next pra interromper a action.
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth/admin', () => ({
  passwordMatches,
  setAdminCookie,
  clearAdminCookie: vi.fn(),
  isAdminAuthenticated: vi.fn(),
}));

vi.mock('@/lib/services/tokenizacao', () => ({}));
vi.mock('@/lib/services/originacao', () => ({}));

import { passwordLoginAction } from '@/app/admin/actions';

beforeEach(() => {
  passwordMatches.mockReset();
  setAdminCookie.mockReset();
  headersGet.mockReset().mockImplementation((name: string) => {
    if (name === 'x-forwarded-for') return '10.0.0.42';
    return null;
  });
});

function makeForm(password: string): FormData {
  const fd = new FormData();
  fd.set('password', password);
  return fd;
}

describe('passwordLoginAction — C-05 rate-limit', () => {
  it('bloqueia após 5 tentativas erradas do mesmo IP', async () => {
    passwordMatches.mockReturnValue(false);
    for (let i = 0; i < 5; i++) {
      const r = await passwordLoginAction(null, makeForm('wrong'));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/inválida/);
    }
    const r = await passwordLoginAction(null, makeForm('wrong'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Muitas tentativas/);
  });

  it('sucesso reseta o bucket — não penaliza usuário legítimo', async () => {
    headersGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '10.0.0.99' : null,
    );
    // 4 falhas + 1 sucesso → bucket reseta.
    passwordMatches.mockReturnValue(false);
    for (let i = 0; i < 4; i++) {
      await passwordLoginAction(null, makeForm('wrong'));
    }
    passwordMatches.mockReturnValue(true);
    // sucesso lança REDIRECT — captura.
    await expect(
      passwordLoginAction(null, makeForm('right')),
    ).rejects.toThrow(/REDIRECT/);
    expect(setAdminCookie).toHaveBeenCalled();

    // Agora pode tentar de novo sem ser bloqueado imediato.
    passwordMatches.mockReturnValue(false);
    const after = await passwordLoginAction(null, makeForm('wrong'));
    expect(after.error).toMatch(/inválida/);
  });
});
