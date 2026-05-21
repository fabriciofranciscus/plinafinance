import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  cookieGet,
  cookieSet,
  sessionFindUnique,
  sessionCreate,
  sessionUpdateMany,
} = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdateMany: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet, set: cookieSet }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    adminSession: {
      findUnique: sessionFindUnique,
      create: sessionCreate,
      updateMany: sessionUpdateMany,
    },
  },
}));

import {
  isAdminAuthenticated,
  setAdminCookie,
  clearAdminCookie,
  ADMIN_COOKIE,
} from '@/lib/auth/admin';

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'secret';
  cookieGet.mockReset();
  cookieSet.mockReset();
  sessionFindUnique.mockReset();
  sessionCreate.mockReset().mockResolvedValue({});
  sessionUpdateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('lib/auth/admin — F-24', () => {
  it('isAdminAuthenticated retorna false sem cookie', async () => {
    cookieGet.mockReturnValueOnce(undefined);
    expect(await isAdminAuthenticated()).toBe(false);
  });

  it('isAdminAuthenticated retorna false se session não existe no DB', async () => {
    cookieGet.mockReturnValueOnce({ value: 'sid_fake' });
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await isAdminAuthenticated()).toBe(false);
  });

  it('isAdminAuthenticated retorna false se session revogada', async () => {
    cookieGet.mockReturnValueOnce({ value: 'sid_1' });
    sessionFindUnique.mockResolvedValueOnce({
      revogadoEm: new Date(),
      expiraEm: new Date(Date.now() + 1_000_000),
    });
    expect(await isAdminAuthenticated()).toBe(false);
  });

  it('isAdminAuthenticated retorna false se session expirou', async () => {
    cookieGet.mockReturnValueOnce({ value: 'sid_1' });
    sessionFindUnique.mockResolvedValueOnce({
      revogadoEm: null,
      expiraEm: new Date(Date.now() - 1_000),
    });
    expect(await isAdminAuthenticated()).toBe(false);
  });

  it('isAdminAuthenticated retorna true com session válida', async () => {
    cookieGet.mockReturnValueOnce({ value: 'sid_1' });
    sessionFindUnique.mockResolvedValueOnce({
      revogadoEm: null,
      expiraEm: new Date(Date.now() + 1_000_000),
    });
    expect(await isAdminAuthenticated()).toBe(true);
  });

  it('setAdminCookie cria session e seta cookie', async () => {
    await setAdminCookie();
    expect(sessionCreate).toHaveBeenCalledOnce();
    const created = sessionCreate.mock.calls[0][0].data;
    expect(created.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiraEm).toBeInstanceOf(Date);
    expect(cookieSet).toHaveBeenCalledOnce();
    expect(cookieSet.mock.calls[0][0]).toMatchObject({
      name: ADMIN_COOKIE,
      value: created.sessionId,
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('clearAdminCookie revoga session no DB e zera cookie', async () => {
    cookieGet.mockReturnValueOnce({ value: 'sid_to_revoke' });
    await clearAdminCookie();
    expect(sessionUpdateMany).toHaveBeenCalledOnce();
    expect(sessionUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { sessionId: 'sid_to_revoke', revogadoEm: null },
    });
    expect(cookieSet.mock.calls[0][0]).toMatchObject({
      name: ADMIN_COOKIE,
      value: '',
      maxAge: 0,
    });
  });
});
