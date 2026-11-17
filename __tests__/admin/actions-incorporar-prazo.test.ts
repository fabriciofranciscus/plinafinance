/**
 * incorporarCotaAction (incorporação avulsa do /admin): `prazoRestanteMeses` 0 = cota QUITADA e precisa chegar ao serviço como 0
 * (antes, `Number(prazo) || undefined` trocava 0 por "sem prazo" e o serviço gravava null). Em branco = sem prazo. Faixa 0..600
 * inteira, a mesma da rota admin/originacao; fora dela é recusado na action com mensagem fixa, sem chamar o serviço.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ incorporarCota: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({
  clearAdminCookie: vi.fn(), isAdminAuthenticated: vi.fn().mockResolvedValue(true), passwordMatches: vi.fn(), setAdminCookie: vi.fn(),
}));
vi.mock('@/lib/rate-limit/config', () => ({ adminLoginLimiter: { consume: vi.fn().mockResolvedValue(true), reset: vi.fn() } }));
vi.mock('@/lib/services/tokenizacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/tokenizacao')>()),
  incorporarCota: m.incorporarCota,
}));
vi.mock('@/lib/services/originacao', () => ({ registrarValidacaoLegal: vi.fn() }));

import { incorporarCotaAction } from '@/app/admin/actions';

const fd = (prazo?: string) => {
  const f = new FormData();
  f.set('tipoBem', 'IMOVEL'); f.set('administradora', 'Adm'); f.set('valorCarta', '100000'); f.set('desagioAquisicao', '0.2');
  if (prazo !== undefined) f.set('prazoRestanteMeses', prazo);
  return f;
};
const prazoEnviado = () => m.incorporarCota.mock.calls[0]![0].prazoRestanteMeses;

beforeEach(() => { m.incorporarCota.mockReset(); m.incorporarCota.mockResolvedValue({ txHash: 'tx' }); });

describe('incorporarCotaAction — prazoRestanteMeses', () => {
  it('"0" (quitada) chega ao serviço como o número 0, não como undefined', async () => {
    expect((await incorporarCotaAction(null, fd('0'))).ok).toBe(true);
    expect(prazoEnviado()).toBe(0);
  });
  it.each([['18', 18], ['600', 600], [' 12 ', 12]])('%j chega como %i', async (entrada, esperado) => {
    await incorporarCotaAction(null, fd(entrada));
    expect(prazoEnviado()).toBe(esperado);
  });
  it.each([[''], ['   ']])('em branco (%j) = sem prazo (undefined)', async (entrada) => {
    await incorporarCotaAction(null, fd(entrada));
    expect(prazoEnviado()).toBeUndefined();
  });
  it('campo ausente = sem prazo', async () => {
    await incorporarCotaAction(null, fd());
    expect(prazoEnviado()).toBeUndefined();
  });
  it.each([['-1'], ['601'], ['1.5'], ['abc'], ['1e2'], ['NaN']])('%j é recusado com mensagem fixa, sem chamar o serviço', async (entrada) => {
    const r = await incorporarCotaAction(null, fd(entrada));
    expect(r).toEqual({ ok: false, error: 'Prazo inválido: informe um número inteiro de 0 a 600 (0 = cota quitada).' });
    expect(m.incorporarCota).not.toHaveBeenCalled();
  });
});
