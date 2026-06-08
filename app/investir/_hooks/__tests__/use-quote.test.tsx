// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardData, QuoteData, Screen } from '../../_types';
import { useQuote } from '../use-quote';

const onboard: OnboardData = {
  investidorId: 'inv-1',
  publicKey: 'GA'.padEnd(56, 'A'),
  etherfuseCustomerId: 'cust-1',
  kycStatus: 'approved',
  fundedNow: false,
};

const sampleQuote: QuoteData = {
  quoteId: 'q-fresh',
  fromAmount: '100.00',
  toAmount: '100.00',
  exchangeRate: '1',
  fee: '0',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface HookProps {
  screen: Screen;
  onRampLoading: boolean;
}

async function flushAsync() {
  // Flush pending microtasks (fetch resolution → res.json → setState).
  // Loop because each await schedules the next microtask in a separate tick.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setup(initial: HookProps) {
  const onError = vi.fn();
  const clearError = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('tkn');
  const { result, rerender } = renderHook(
    (props: HookProps) =>
      useQuote({
        onboard,
        classe: 'SENIOR',
        screen: props.screen,
        onRampLoading: props.onRampLoading,
        getAccessToken,
        onError,
        clearError,
      }),
    { initialProps: initial },
  );
  return { result, rerender, onError, clearError, getAccessToken };
}

describe('useQuote — race condition gate (commit 0cc6a24)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('descarta resposta stale quando screen saiu de quote antes do fetch retornar', async () => {
    const d = deferred<Response>();
    fetchMock.mockReturnValueOnce(d.promise);

    const { result, rerender } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // user clicou "revisar compra" — screen muda antes da resposta chegar
    rerender({ screen: 'onramp', onRampLoading: false });

    await act(async () => {
      d.resolve(jsonResponse(sampleQuote));
      await d.promise.catch(() => {});
    });
    await flushAsync();
    expect(result.current.quoteLoading).toBe(false);

    // gate descartou: quote permanece null
    expect(result.current.quote).toBeNull();
  });

  it('descarta resposta stale quando onRampLoading vira true durante o fetch', async () => {
    const d = deferred<Response>();
    fetchMock.mockReturnValueOnce(d.promise);

    const { result, rerender } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // /onramp/create começou enquanto o fetch de quote ainda voa
    rerender({ screen: 'quote', onRampLoading: true });

    await act(async () => {
      d.resolve(jsonResponse(sampleQuote));
      await d.promise.catch(() => {});
    });
    await flushAsync();
    expect(result.current.quoteLoading).toBe(false);

    expect(result.current.quote).toBeNull();
  });

  it('aplica setQuote quando screen=quote e onRampLoading=false ao retorno', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleQuote));

    const { result } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await flushAsync();
    expect(result.current.quote).not.toBeNull();
    expect(result.current.quote?.quoteId).toBe('q-fresh');
  });

  it('debouncer NÃO agenda fetch se onRampLoading=true', async () => {
    const { result } = setup({ screen: 'quote', onRampLoading: true });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debouncer NÃO agenda fetch se screen != quote', async () => {
    const { result } = setup({ screen: 'onramp', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debouncer cancela timer pendente quando onRampLoading vira true antes dos 600ms', async () => {
    const { result, rerender } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    // antes do debounce disparar, user clica revisar
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ screen: 'quote', onRampLoading: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resetQuote limpa quote previamente aplicada', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleQuote));
    const { result } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flushAsync();
    expect(result.current.quote).not.toBeNull();

    act(() => result.current.resetQuote());
    expect(result.current.quote).toBeNull();
  });

  it('propaga erro via asFlowError quando fetch retorna não-ok', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('etherfuse limit reached', { status: 500 }),
    );
    const { result, onError } = setup({ screen: 'quote', onRampLoading: false });

    act(() => result.current.setAmountBrl('100,00'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flushAsync();
    expect(onError).toHaveBeenCalled();

    const call = onError.mock.calls[0][0];
    expect(call).toHaveProperty('ticketId');
    expect(call).toHaveProperty('message');
    expect(call).toHaveProperty('technical');
  });
});
