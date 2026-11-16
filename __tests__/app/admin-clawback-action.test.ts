/** executarClawbackAction (U1-11): o pedidoId chega ao serviço; erro FIXO (nunca err.message); só revalida em sucesso. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ executar: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ clearAdminCookie: vi.fn(), isAdminAuthenticated: async () => true, passwordMatches: vi.fn(), setAdminCookie: vi.fn() }));
vi.mock('@/lib/rate-limit/config', () => ({ adminLoginLimiter: { consume: async () => true } }));
vi.mock('@/lib/services/originacao', () => ({ registrarValidacaoLegal: vi.fn() }));
vi.mock('@/lib/services/tokenizacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/tokenizacao')>()),
  executarClawback: m.executar, incorporarCota: vi.fn(), atualizarStatusCota: vi.fn(),
}));

import { executarClawbackAction } from '@/app/admin/actions';
import { ClawbackError } from '@/lib/services/tokenizacao';

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ investidorId: 'inv_1', amount: '100', motivo: 'ERRO_OPERACIONAL', fundamentoUrl: 'https://x.test/d.pdf', pedidoId: 'pedido-0123456789abcdef', ...over })) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.executar.mockReset().mockResolvedValue({ txHash: 'tx1', fundamentoTxHash: 'tx2', payloadHash: 'h' });
  m.revalidate.mockReset();
});

describe('executarClawbackAction', () => {
  it('passa o pedidoId do formulário ao serviço e revalida só em sucesso', async () => {
    const r = await executarClawbackAction(null, form());
    expect(r).toEqual({ ok: true, txHash: 'tx1' });
    expect(m.executar.mock.calls[0]![0]).toMatchObject({ pedidoId: 'pedido-0123456789abcdef', investidorId: 'inv_1', operador: 'admin-panel' });
    expect(m.revalidate).toHaveBeenCalledWith('/admin');
  });

  it('2º envio do mesmo pedido: devolve o resultado com idempotente:true, sem erro', async () => {
    m.executar.mockResolvedValueOnce({ txHash: 'tx1', fundamentoTxHash: 'tx2', payloadHash: 'h', idempotente: true });
    expect(await executarClawbackAction(null, form())).toEqual({ ok: true, txHash: 'tx1', idempotente: true });
  });

  it('erro tipado: mensagem FIXA e code; REGISTRO_PENDENTE leva o txHash; sem revalidar', async () => {
    m.executar.mockRejectedValueOnce(new ClawbackError('PEDIDO_EM_ANDAMENTO'));
    const a = await executarClawbackAction(null, form());
    expect(a).toMatchObject({ ok: false, code: 'PEDIDO_EM_ANDAMENTO' });
    m.executar.mockRejectedValueOnce(new ClawbackError('REGISTRO_PENDENTE', 'tx_na_rede'));
    expect(await executarClawbackAction(null, form())).toMatchObject({ ok: false, code: 'REGISTRO_PENDENTE', txHash: 'tx_na_rede' });
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it('erro inesperado (Prisma/Stellar com valores, variável e e-mail) → "erro interno" fixo; nada do texto vai à tela', async () => {
    m.executar.mockRejectedValueOnce(new Error('Invalid `prisma.investidor.update()`: STELLAR_ISSUER_SECRET ana@exemplo.test'));
    const r = await executarClawbackAction(null, form());
    expect(r).toEqual({ ok: false, error: 'erro interno' });
  });
});
