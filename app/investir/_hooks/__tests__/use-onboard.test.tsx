// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardData } from '../../_types';
import { KYC_POLL_MAX, KYC_POLL_MS, useOnboard } from '../use-onboard';

const base: OnboardData = {
  investidorId: 'inv-1',
  publicKey: 'GA'.padEnd(56, 'A'),
  etherfuseCustomerId: 'cust-1',
  kycStatus: 'pending',
  fundedNow: false,
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('useOnboard — E2-3: verificação por webhook', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup() {
    return renderHook(() =>
      useOnboard({
        getAccessToken: vi.fn().mockResolvedValue('tkn'),
        onError: vi.fn(),
        clearError: vi.fn(),
      }),
    );
  }

  it('pendente: relê a cada 5 s até aprovar e para', async () => {
    fetchMock
      .mockResolvedValueOnce(json(base)) // onboard inicial
      .mockResolvedValueOnce(json(base)) // 1ª releitura: ainda pendente
      .mockResolvedValueOnce(json({ ...base, kycStatus: 'approved' })); // webhook chegou
    const { result } = setup();
    await act(async () => {
      await result.current.runOnboard();
    });
    expect(result.current.kycPending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS);
    });
    expect(result.current.kycPending).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS);
    });
    expect(result.current.onboard?.kycStatus).toBe('approved');
    expect(result.current.kycPending).toBe(false);

    const chamadas = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS * 5);
    });
    expect(fetchMock.mock.calls.length).toBe(chamadas); // parou de reler
  });

  it('já aprovado: não faz polling', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...base, kycStatus: 'approved' }));
    const { result } = setup();
    await act(async () => {
      await result.current.runOnboard();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.kycPending).toBe(false);
  });

  it('falha de rede numa releitura não derruba: a próxima tenta de novo', async () => {
    fetchMock
      .mockResolvedValueOnce(json(base))
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce(json({ ...base, kycStatus: 'approved' }));
    const { result } = setup();
    await act(async () => {
      await result.current.runOnboard();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS * 2);
    });
    expect(result.current.kycPending).toBe(false);
  });

  it(`sem confirmação em ${KYC_POLL_MAX} leituras: para e sinaliza kycTimedOut`, async () => {
    fetchMock.mockImplementation(async () => json(base));
    const { result } = setup();
    await act(async () => {
      await result.current.runOnboard();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS * (KYC_POLL_MAX + 2));
    });
    expect(result.current.kycTimedOut).toBe(true);
    const chamadas = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KYC_POLL_MS * 5);
    });
    expect(fetchMock.mock.calls.length).toBe(chamadas);
  });
});
