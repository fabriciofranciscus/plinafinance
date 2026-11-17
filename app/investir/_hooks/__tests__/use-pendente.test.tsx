// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdemPendente } from '../../_types';
import { usePendente } from '../use-pendente';

const ordem: OrdemPendente = {
  fase: 'concluir_swap',
  criadoEm: '2026-11-16T10:00:00.000Z',
  quote: { quoteId: 'q-1', fromAmount: '300', toAmount: '307.1234567', plinarfAmount: '307.1234567', navPorTokenNaCotacao: '1.00000000', exchangeRate: '1.02', fee: '0', expiresAt: '2026-11-16T10:02:00.000Z' },
  onRamp: { orderId: 'or-1', status: 'completed', paymentInstructions: null, mock: false, stellarTxHash: 't', stellarClaimableBalanceId: 'cb', claimTxHash: 'c' },
};
const envelope = (pendente: OrdemPendente | null) =>
  new Response(JSON.stringify({ data: { pendente }, error: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('usePendente (U2 A-02)', () => {
  it('lê a compra pendente uma vez, com o Bearer da sessão', async () => {
    fetchMock.mockResolvedValue(envelope(ordem));
    const { result } = renderHook(() => usePendente({ enabled: true, getAccessToken: async () => 'tok' }));
    await flush();
    expect(result.current.pendente).toEqual(ordem);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/investidor/buy/pendente');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('sem sessão pronta (enabled=false) não consulta nada', async () => {
    renderHook(() => usePendente({ enabled: false, getAccessToken: async () => 'tok' }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getAccessToken que muda de identidade a cada render NÃO repete o GET em laço', async () => {
    fetchMock.mockResolvedValue(envelope(null));
    const { rerender } = renderHook(() => usePendente({ enabled: true, getAccessToken: async () => 'tok' })); // função nova a cada render
    await flush();
    for (let i = 0; i < 5; i++) rerender();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha da rede ou do servidor → sem cartão (o fluxo normal não depende dele) e sem lançar', async () => {
    fetchMock.mockRejectedValueOnce(new Error('rede caiu'));
    const { result } = renderHook(() => usePendente({ enabled: true, getAccessToken: async () => 'tok' }));
    await flush();
    expect(result.current.pendente).toBeNull();
  });

  it('resposta { pendente: null } → sem cartão; limpar() tira o cartão', async () => {
    fetchMock.mockResolvedValue(envelope(ordem));
    const { result } = renderHook(() => usePendente({ enabled: true, getAccessToken: async () => 'tok' }));
    await flush();
    expect(result.current.pendente).not.toBeNull();
    act(() => result.current.limpar());
    expect(result.current.pendente).toBeNull();
  });
});
