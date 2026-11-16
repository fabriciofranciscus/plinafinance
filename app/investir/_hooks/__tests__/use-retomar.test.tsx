// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaseOrdemPendente } from '@/lib/services/ordem-pendente';
import type { OnboardData, OnRampData, OrdemPendente, QuoteData } from '../../_types';
import { useRetomar } from '../use-retomar';

const quote: QuoteData = { quoteId: 'q-1', fromAmount: '300', toAmount: '307.1234567', exchangeRate: '1', fee: '0', expiresAt: '2026-11-16T10:02:00.000Z' };
const onRamp: OnRampData = { orderId: 'or-1', status: 'completed', paymentInstructions: null, mock: false, stellarTxHash: 't', stellarClaimableBalanceId: 'cb', claimTxHash: 'c' };
const onboard: OnboardData = { investidorId: 'inv_1', publicKey: 'GABC', etherfuseCustomerId: 'cus', kycStatus: 'approved', fundedNow: false };
const ordem = (fase: FaseOrdemPendente): OrdemPendente => ({ fase, criadoEm: '2026-11-16T10:00:00.000Z', quote, onRamp });

interface Props { onboard: OnboardData | null; quote: QuoteData | null; onRamp: OnRampData | null }
function setup(fase: FaseOrdemPendente, inicial: Props) {
  const fn = {
    runOnboard: vi.fn(), restoreQuote: vi.fn(), restoreOnRamp: vi.fn(), setScreen: vi.fn(), goToConfirm: vi.fn(), onRetomada: vi.fn(),
  };
  const pendente = ordem(fase);
  const hook = renderHook((p: Props) => useRetomar({ pendente, ...p, ...fn }), { initialProps: inicial });
  return { ...hook, fn, pendente };
}
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const COMPLETO: Props = { onboard, quote: null, onRamp: null };

beforeEach(() => vi.clearAllMocks());

describe('useRetomar (U2 A-02)', () => {
  it.each([
    ['aguardando_pagamento', 'onramp'],
    ['liquidando', 'settling'],
    ['resgatar_tesouro', 'claiming'],
  ] as const)('fase %s: restaura quote e onRamp e abre a tela %s', async (fase, tela) => {
    const { result, rerender, fn } = setup(fase, COMPLETO);
    expect(fn.setScreen).not.toHaveBeenCalled(); // nunca avança sozinho
    act(() => result.current.retomar());
    await flush();
    expect(fn.restoreQuote).toHaveBeenCalledWith(quote);
    expect(fn.restoreOnRamp).toHaveBeenCalledWith(onRamp);
    rerender({ onboard, quote, onRamp }); // os hooks já refletem a ordem restaurada
    await flush();
    expect(fn.setScreen).toHaveBeenCalledWith(tela);
    expect(fn.goToConfirm).not.toHaveBeenCalled();
    expect(fn.onRetomada).toHaveBeenCalledTimes(1);
  });

  it('fase concluir_swap: chama o goToConfirm de sempre (build do swap), e não escolhe tela sozinha', async () => {
    const { result, rerender, fn } = setup('concluir_swap', COMPLETO);
    act(() => result.current.retomar());
    await flush();
    rerender({ onboard, quote, onRamp });
    await flush();
    expect(fn.goToConfirm).toHaveBeenCalledTimes(1);
    expect(fn.setScreen).not.toHaveBeenCalled();
    expect(fn.onRetomada).toHaveBeenCalledTimes(1);
  });

  it('o goToConfirm só roda DEPOIS que quote e onRamp restaurados chegam ao estado (ele lê o render atual)', async () => {
    const { result, fn } = setup('concluir_swap', COMPLETO);
    act(() => result.current.retomar());
    await flush();
    expect(fn.restoreQuote).toHaveBeenCalled();
    expect(fn.goToConfirm).not.toHaveBeenCalled(); // estado ainda é null
    expect(result.current.retomando).toBe(true);
  });

  it('com quote de OUTRA ordem no estado, não aplica a retomada', async () => {
    const { result, rerender, fn } = setup('concluir_swap', COMPLETO);
    act(() => result.current.retomar());
    await flush();
    rerender({ onboard, quote: { ...quote, quoteId: 'q-outro' }, onRamp });
    await flush();
    expect(fn.goToConfirm).not.toHaveBeenCalled();
  });

  it('sem onboard: dispara o onboard (idempotente) e só restaura depois que ele chega', async () => {
    const { result, rerender, fn } = setup('concluir_swap', { onboard: null, quote: null, onRamp: null });
    act(() => result.current.retomar());
    await flush();
    expect(fn.runOnboard).toHaveBeenCalledTimes(1);
    expect(fn.restoreQuote).not.toHaveBeenCalled();
    rerender({ onboard, quote: null, onRamp: null });
    await flush();
    expect(fn.restoreQuote).toHaveBeenCalledWith(quote);
  });

  it('com onboard presente NÃO dispara o onboard de novo', async () => {
    const { result, fn } = setup('liquidando', COMPLETO);
    act(() => result.current.retomar());
    await flush();
    expect(fn.runOnboard).not.toHaveBeenCalled();
  });

  it('fase em_conferencia: sem ação (não restaura, não navega, não faz onboard)', async () => {
    const { result, fn } = setup('em_conferencia', COMPLETO);
    act(() => result.current.retomar());
    await flush();
    expect(result.current.retomando).toBe(false);
    expect(fn.restoreQuote).not.toHaveBeenCalled();
    expect(fn.setScreen).not.toHaveBeenCalled();
    expect(fn.goToConfirm).not.toHaveBeenCalled();
    expect(fn.runOnboard).not.toHaveBeenCalled();
  });

  it('sem compra pendente: retomar() não faz nada', async () => {
    const fn = { runOnboard: vi.fn(), restoreQuote: vi.fn(), restoreOnRamp: vi.fn(), setScreen: vi.fn(), goToConfirm: vi.fn(), onRetomada: vi.fn() };
    const { result } = renderHook(() => useRetomar({ pendente: null, onboard, quote: null, onRamp: null, ...fn }));
    act(() => result.current.retomar());
    await flush();
    expect(result.current.retomando).toBe(false);
    expect(fn.restoreQuote).not.toHaveBeenCalled();
  });
});
