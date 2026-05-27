// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnRampData, QuoteData, Screen } from '../../_types';
import { useOnRamp } from '../use-onramp';

const quote: QuoteData = {
  quoteId: 'q-1',
  fromAmount: '100.00',
  toAmount: '100.00',
  exchangeRate: '1',
  fee: '0',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const createdOnRamp: OnRampData = {
  orderId: 'or-9',
  status: 'pending',
  paymentInstructions: { pixCode: 'pix-code' },
  mock: false,
  stellarTxHash: null,
  stellarClaimableBalanceId: null,
  claimTxHash: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface HookProps {
  screen: Screen;
  quote: QuoteData | null;
  onRampLoading: boolean;
}

function setup(initial: HookProps) {
  const onError = vi.fn();
  const clearError = vi.fn();
  const onCreated = vi.fn();
  const onSandboxPaid = vi.fn();
  const setOnRampLoading = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('tkn');
  const { result, rerender } = renderHook(
    (p: HookProps) =>
      useOnRamp({
        quote: p.quote,
        screen: p.screen,
        getAccessToken,
        onError,
        clearError,
        onCreated,
        onSandboxPaid,
        setOnRampLoading,
        onRampLoading: p.onRampLoading,
      }),
    { initialProps: initial },
  );
  return {
    result,
    rerender,
    onError,
    clearError,
    onCreated,
    onSandboxPaid,
    setOnRampLoading,
    getAccessToken,
  };
}

describe('useOnRamp — goToOnramp', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cria onramp, seta state e dispara onCreated', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result, onCreated, setOnRampLoading } = setup({
      screen: 'quote',
      quote,
      onRampLoading: false,
    });
    await act(async () => {
      await result.current.goToOnramp();
    });
    expect(result.current.onRamp?.orderId).toBe('or-9');
    expect(onCreated).toHaveBeenCalledTimes(1);
    // setOnRampLoading(true) no início, (false) no finally
    expect(setOnRampLoading.mock.calls).toEqual([[true], [false]]);
  });

  it('no-op sem quote', async () => {
    const { result, onCreated, setOnRampLoading } = setup({
      screen: 'quote',
      quote: null,
      onRampLoading: false,
    });
    await act(async () => {
      await result.current.goToOnramp();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(setOnRampLoading).not.toHaveBeenCalled();
  });

  it('propaga erro e finaliza onRampLoading=false', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('etherfuse limit', { status: 500 }),
    );
    const { result, onError, setOnRampLoading, onCreated } = setup({
      screen: 'quote',
      quote,
      onRampLoading: false,
    });
    await act(async () => {
      await result.current.goToOnramp();
    });
    expect(onError).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(setOnRampLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('useOnRamp — settling polling (3s)', () => {
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

  it('polling pollar até status=completed e então para', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result, rerender } = setup({ screen: 'quote', quote, onRampLoading: false });
    await act(async () => {
      await result.current.goToOnramp();
    });
    fetchMock.mockClear();

    // Sequência: 2 ticks 'processing' → 1 'completed' → não pollar mais.
    // Cada setOnRamp muda a ref e remonta o efeito; o invariante que
    // importa é que ele para em 'completed', não a cadência exata.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 'processing', stellarTxHash: null, mock: false }))
      .mockResolvedValueOnce(jsonResponse({ status: 'processing', stellarTxHash: null, mock: false }))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', stellarTxHash: 'tx-anchor', mock: false }))
      .mockResolvedValue(jsonResponse({ status: 'completed', stellarTxHash: 'tx-anchor', mock: false }));

    rerender({ screen: 'settling', quote, onRampLoading: false });

    // Drena ticks + remounts até o efeito early-return em 'completed'.
    for (let i = 0; i < 10; i++) {
      await flushAsync();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
    }

    expect(result.current.onRamp?.status).toBe('completed');
    const callsAtCompletion = fetchMock.mock.calls.length;

    // Após 'completed', avançar tempo não dispara mais fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await flushAsync();
    expect(fetchMock.mock.calls.length).toBe(callsAtCompletion);
  });

  it('cleanup: cancelled=true descarta setState pós-unmount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result, rerender } = setup({ screen: 'quote', quote, onRampLoading: false });
    await act(async () => {
      await result.current.goToOnramp();
    });

    // tick em voo quando saímos do settling
    let resolveTick!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveTick = res;
      }),
    );

    rerender({ screen: 'settling', quote, onRampLoading: false });
    await flushAsync();
    // efeito chamou fetch (tick), mas resposta segura
    expect(fetchMock).toHaveBeenCalledTimes(2); // [0]=create, [1]=tick

    // sai do settling antes da resposta — interval limpa, cancelled=true
    rerender({ screen: 'claiming', quote, onRampLoading: false });

    const before = result.current.onRamp;
    await act(async () => {
      resolveTick(jsonResponse({ status: 'completed', stellarTxHash: 'x', mock: false }));
    });
    await flushAsync();

    // setOnRamp não foi aplicado (cancelled=true)
    expect(result.current.onRamp).toEqual(before);
  });

  it('não pollar se status já é completed ao entrar em settling', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...createdOnRamp, status: 'completed', stellarTxHash: 'tx' }),
    );
    const { result, rerender } = setup({ screen: 'quote', quote, onRampLoading: false });
    await act(async () => {
      await result.current.goToOnramp();
    });
    fetchMock.mockClear();
    rerender({ screen: 'settling', quote, onRampLoading: false });
    await flushAsync();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.onRamp?.status).toBe('completed');
  });
});

describe('useOnRamp — sandboxPay & misc', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sandboxPay mergeia status novo no onRamp e chama onSandboxPaid', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result, onSandboxPaid } = setup({
      screen: 'onramp',
      quote,
      onRampLoading: false,
    });
    await act(async () => {
      await result.current.goToOnramp();
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'processing',
        stellarTxHash: 'tx-sandbox',
        stellarClaimableBalanceId: 'cb-1',
        mock: true,
      }),
    );
    await act(async () => {
      await result.current.sandboxPay();
    });
    expect(result.current.onRamp?.status).toBe('processing');
    expect(result.current.onRamp?.stellarTxHash).toBe('tx-sandbox');
    expect(result.current.onRamp?.stellarClaimableBalanceId).toBe('cb-1');
    // orderId preservado do merge
    expect(result.current.onRamp?.orderId).toBe('or-9');
    expect(onSandboxPaid).toHaveBeenCalledTimes(1);
  });

  it('sandboxPay no-op sem onRamp', async () => {
    const { result, onSandboxPaid } = setup({
      screen: 'onramp',
      quote,
      onRampLoading: false,
    });
    await act(async () => {
      await result.current.sandboxPay();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSandboxPaid).not.toHaveBeenCalled();
  });

  it('applyClaimTxHash mergeia campo sem perder estado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result } = setup({ screen: 'onramp', quote, onRampLoading: false });
    await act(async () => {
      await result.current.goToOnramp();
    });
    act(() => result.current.applyClaimTxHash('claim-hash-1'));
    expect(result.current.onRamp?.claimTxHash).toBe('claim-hash-1');
    expect(result.current.onRamp?.orderId).toBe('or-9');
  });

  it('resetOnRamp zera state', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createdOnRamp));
    const { result } = setup({ screen: 'onramp', quote, onRampLoading: false });
    await act(async () => {
      await result.current.goToOnramp();
    });
    expect(result.current.onRamp).not.toBeNull();
    act(() => result.current.resetOnRamp());
    expect(result.current.onRamp).toBeNull();
  });
});
