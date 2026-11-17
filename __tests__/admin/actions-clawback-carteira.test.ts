/** executarClawbackAction repassa a carteira da revisão (`carteiraRevisada`) ao serviço e devolve o erro fixo da divergência. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ executarClawback: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({
  clearAdminCookie: vi.fn(), isAdminAuthenticated: vi.fn().mockResolvedValue(true), passwordMatches: vi.fn(), setAdminCookie: vi.fn(),
}));
vi.mock('@/lib/rate-limit/config', () => ({ adminLoginLimiter: { consume: vi.fn().mockResolvedValue(true), reset: vi.fn() } }));
vi.mock('@/lib/services/tokenizacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/tokenizacao')>()),
  executarClawback: m.executarClawback,
}));
vi.mock('@/lib/services/originacao', () => ({ registrarValidacaoLegal: vi.fn() }));

import { executarClawbackAction } from '@/app/admin/actions';
import { ClawbackError } from '@/lib/services/tokenizacao';

const fd = (carteira?: string) => {
  const f = new FormData();
  f.set('investidorId', 'inv_1'); f.set('amount', '10'); f.set('motivo', 'ERRO_OPERACIONAL');
  f.set('fundamentoUrl', 'https://x.test/d.pdf'); f.set('pedidoId', 'pedido-0123456789abcdef');
  if (carteira !== undefined) f.set('carteiraRevisada', carteira);
  return f;
};
beforeEach(() => { m.executarClawback.mockReset(); m.executarClawback.mockResolvedValue({ txHash: 'tx' }); });

describe('executarClawbackAction — carteiraRevisada', () => {
  it('repassa a carteira do formulário ao serviço (sem alterá-la)', async () => {
    await executarClawbackAction(null, fd('GABC'));
    expect(m.executarClawback.mock.calls[0]![0].carteiraRevisada).toBe('GABC');
  });
  it('campo ausente ou em branco: undefined (comportamento anterior até o PR 3)', async () => {
    await executarClawbackAction(null, fd());
    await executarClawbackAction(null, fd('   '));
    expect(m.executarClawback.mock.calls[0]![0].carteiraRevisada).toBeUndefined();
    expect(m.executarClawback.mock.calls[1]![0].carteiraRevisada).toBeUndefined();
  });
  it('divergência: devolve o código e a mensagem fixos da classe, sem txHash', async () => {
    m.executarClawback.mockRejectedValue(new ClawbackError('CARTEIRA_DIVERGENTE'));
    const r = await executarClawbackAction(null, fd('GXYZ'));
    expect(r).toEqual({ ok: false, error: new ClawbackError('CARTEIRA_DIVERGENTE').message, code: 'CARTEIRA_DIVERGENTE' });
  });
});
