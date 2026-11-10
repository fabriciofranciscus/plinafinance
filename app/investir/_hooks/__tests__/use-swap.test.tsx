// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OnRampData,
  OnboardData,
  QuoteData,
  SwapEnvelope,
  SwapMockResult,
} from '../../_types';
import { useSwap } from '../use-swap';

// N1: o envelope assinado é montado por `attachInvestorSignature` (testado à
// parte, com chaves reais em `signed-xdr.test.ts`). Aqui os XDRs são strings
// de fixture, então o helper é substituído por um stub que registra a chamada.
const signedXdrCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('../../_lib/signed-xdr', () => ({
  attachInvestorSignature: (...args: unknown[]) => {
    signedXdrCalls.push(args);
    return 'signed-xdr-1';
  },
}));

const onboard: OnboardData = {
  investidorId: 'inv-1',
  publicKey: 'GA'.padEnd(56, 'A'),
  etherfuseCustomerId: 'cust-1',
  kycStatus: 'approved',
  fundedNow: false,
};

const quote: QuoteData = {
  quoteId: 'q-1',
  fromAmount: '100.00',
  toAmount: '100.00',
  exchangeRate: '1',
  fee: '0',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function onRamp(overrides: Partial<OnRampData> = {}): OnRampData {
  return {
    orderId: 'or-1',
    status: 'completed',
    paymentInstructions: null,
    mock: false,
    stellarTxHash: 'tx-onramp',
    stellarClaimableBalanceId: null,
    claimTxHash: null,
    ...overrides,
  };
}

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

interface Setup {
  onRampOverrides?: Partial<OnRampData>;
  signature?: string;
}

function setup(s: Setup = {}) {
  const onError = vi.fn();
  const clearError = vi.fn();
  const onNextScreen = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('tkn');
  const signRawHash = vi
    .fn()
    .mockResolvedValue({ signature: s.signature ?? '0xfeed' });
  const { result } = renderHook(() =>
    useSwap({
      onboard,
      quote,
      onRamp: onRamp(s.onRampOverrides),
      signRawHash,
      getAccessToken,
      onError,
      clearError,
      onNextScreen,
    }),
  );
  return { result, onError, clearError, onNextScreen, getAccessToken, signRawHash };
}

describe('useSwap — goToConfirm: onRampReady gate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('bloqueia quando status=processing sem ClaimableBalance', async () => {
    const { result, onNextScreen } = setup({
      onRampOverrides: { status: 'processing', stellarClaimableBalanceId: null },
    });
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onNextScreen).not.toHaveBeenCalled();
  });

  it('prossegue quando status=processing mas tem stellarClaimableBalanceId (desvia pra claiming)', async () => {
    const { result, onNextScreen } = setup({
      onRampOverrides: {
        status: 'processing',
        stellarClaimableBalanceId: 'cb-1',
        claimTxHash: null,
      },
    });
    await act(async () => {
      await result.current.goToConfirm();
    });
    // CB pendente sem claim → desvia pra claiming, sem chamar /swap/build
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onNextScreen).toHaveBeenCalledWith('claiming');
  });

  it('prossegue quando status=completed (sem CB)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: 'xdr-1',
        hashHex: '0xabc',
        mock: false,
      } satisfies SwapEnvelope),
    );
    const { result, onNextScreen } = setup({ onRampOverrides: { status: 'completed' } });
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNextScreen).toHaveBeenCalledWith('confirm');
  });
});

describe('useSwap — goToConfirm: mock branch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('mock: true pula direto pro receipt sem confirm/buy', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        txHash: 'mock-tx',
        mock: true,
        alreadyExecuted: true,
      } satisfies SwapMockResult),
    );
    const { result, onNextScreen } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(onNextScreen).toHaveBeenCalledWith('receipt');
    expect(onNextScreen).not.toHaveBeenCalledWith('confirm');
    expect(result.current.buyResult).toEqual({
      swapTxHash: 'mock-tx',
      onRampTxHash: 'tx-onramp',
      mock: true,
    });
  });

  it('real branch (mock=false) vai pro confirm e NÃO seta buyResult', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: 'xdr-1',
        hashHex: '0xabc',
        mock: false,
      } satisfies SwapEnvelope),
    );
    const { result, onNextScreen } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(onNextScreen).toHaveBeenCalledWith('confirm');
    expect(result.current.buyResult).toBeNull();
    expect(result.current.swapBuild?.mock).toBe(false);
  });
});

describe('useSwap — goToConfirm: claiming detour', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('CB pendente (claimableBalanceId && !claimTxHash) desvia pra claiming antes do build', async () => {
    const { result, onNextScreen } = setup({
      onRampOverrides: {
        status: 'completed',
        stellarClaimableBalanceId: 'cb-99',
        claimTxHash: null,
      },
    });
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(onNextScreen).toHaveBeenCalledWith('claiming');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CB já reclamada (claimableBalanceId && claimTxHash) prossegue pro build normal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: 'xdr-1',
        hashHex: '0xabc',
        mock: false,
      } satisfies SwapEnvelope),
    );
    const { result, onNextScreen } = setup({
      onRampOverrides: {
        status: 'completed',
        stellarClaimableBalanceId: 'cb-99',
        claimTxHash: 'claim-tx',
      },
    });
    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNextScreen).toHaveBeenCalledWith('confirm');
  });
});

describe('useSwap — buy', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('build → sign → submit setando buyResult e indo pra receipt', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: 'xdr-1',
        hashHex: '0xdeadbeef',
        mock: false,
      } satisfies SwapEnvelope),
    );
    const { result, onNextScreen, signRawHash } = setup();

    await act(async () => {
      await result.current.goToConfirm();
    });
    expect(result.current.swapBuild?.mock).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ swapTxHash: 'real-tx' }));

    await act(async () => {
      await result.current.buy();
    });
    await flushAsync();

    expect(signRawHash).toHaveBeenCalledWith({
      address: onboard.publicKey,
      chainType: 'stellar',
      hash: '0xdeadbeef',
    });
    expect(result.current.buyResult).toEqual({
      swapTxHash: 'real-tx',
      onRampTxHash: 'tx-onramp',
      mock: false,
    });
    expect(onNextScreen).toHaveBeenLastCalledWith('receipt');
  });

  it('buy() no-op se swapBuild.mock=true (já consumado no build)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        txHash: 'mock-tx',
        mock: true,
        alreadyExecuted: true,
      } satisfies SwapMockResult),
    );
    const { result, signRawHash } = setup();

    await act(async () => {
      await result.current.goToConfirm();
    });
    fetchMock.mockClear();

    await act(async () => {
      await result.current.buy();
    });
    expect(signRawHash).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha se token Privy ausente', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        xdr: 'xdr-1',
        hashHex: '0xabc',
        mock: false,
      } satisfies SwapEnvelope),
    );
    const { result, onError, getAccessToken } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });

    getAccessToken.mockResolvedValueOnce(null);
    await act(async () => {
      await result.current.buy();
    });
    await flushAsync();

    expect(onError).toHaveBeenCalled();
    expect(result.current.buyResult).toBeNull();
  });
});

describe('useSwap — buy: corpo do submit (N1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    signedXdrCalls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  const envelope = {
    xdr: 'xdr-1',
    hashHex: '0xdeadbeef',
    mock: false,
  } satisfies SwapEnvelope;

  it('envia só { quoteId, signedXdr }, sem assinatura nem chave da Plina', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));
    const { result } = setup({ signature: '0xfeed' });
    await act(async () => {
      await result.current.goToConfirm();
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ swapTxHash: 'real-tx' }));
    await act(async () => {
      await result.current.buy();
    });
    await flushAsync();

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/investidor/buy/swap/submit');
    expect(JSON.parse(String(init.body))).toEqual({
      quoteId: 'q-1',
      signedXdr: 'signed-xdr-1',
    });
    // A assinatura do investidor foi anexada ao XDR do build.
    expect(signedXdrCalls).toEqual([['xdr-1', onboard.publicKey, '0xfeed']]);
  });

  it('409 NAV_MUDOU: mensagem fixa, sem incidente, e recotar refaz o build', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));
    const { result, onError, onNextScreen } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'NAV mudou', code: 'NAV_MUDOU' }, 409),
    );
    await act(async () => {
      await result.current.buy();
    });
    await flushAsync();

    expect(result.current.navMudou).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.buyResult).toBeNull();

    // Recotar: novo build (sem novo on-ramp) e o aviso some.
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));
    await act(async () => {
      await result.current.requote();
    });
    await flushAsync();
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/investidor/buy/swap/build');
    expect(result.current.navMudou).toBe(false);
    expect(onNextScreen).toHaveBeenLastCalledWith('confirm');
  });

  it('409 de outro motivo segue o caminho de erro normal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope));
    const { result, onError } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'quote já consumido' }, 409));
    await act(async () => {
      await result.current.buy();
    });
    await flushAsync();
    expect(result.current.navMudou).toBe(false);
    expect(onError).toHaveBeenCalled();
  });
});

describe('useSwap — reset', () => {
  it('limpa buyResult, swapBuild e signConfirmed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        txHash: 'mock-tx',
        mock: true,
        alreadyExecuted: true,
      } satisfies SwapMockResult),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    await act(async () => {
      await result.current.goToConfirm();
    });
    act(() => result.current.setSignConfirmed(true));
    expect(result.current.swapBuild).not.toBeNull();
    expect(result.current.buyResult).not.toBeNull();
    expect(result.current.signConfirmed).toBe(true);

    act(() => result.current.reset());
    expect(result.current.swapBuild).toBeNull();
    expect(result.current.buyResult).toBeNull();
    expect(result.current.signConfirmed).toBe(false);

    vi.unstubAllGlobals();
  });
});
