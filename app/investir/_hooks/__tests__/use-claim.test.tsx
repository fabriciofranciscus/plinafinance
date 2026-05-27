// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnRampData, OnboardData } from '../../_types';
import { useClaim } from '../use-claim';

const onboard: OnboardData = {
  investidorId: 'inv-1',
  publicKey: 'GA'.padEnd(56, 'A'),
  etherfuseCustomerId: 'cust-1',
  kycStatus: 'approved',
  fundedNow: false,
};

function onRampWith(overrides: Partial<OnRampData> = {}): OnRampData {
  return {
    orderId: 'or-1',
    status: 'processing',
    paymentInstructions: null,
    mock: false,
    stellarTxHash: 'tx-on',
    stellarClaimableBalanceId: 'cb-xyz',
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

function setup(onRamp: OnRampData | null = onRampWith()) {
  const onError = vi.fn();
  const clearError = vi.fn();
  const onClaimed = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('tkn');
  const signRawHash = vi.fn().mockResolvedValue({ signature: '0xclaimsig' });
  const { result } = renderHook(() =>
    useClaim({
      onboard,
      onRamp,
      signRawHash,
      getAccessToken,
      onError,
      clearError,
      onClaimed,
    }),
  );
  return { result, onError, clearError, onClaimed, getAccessToken, signRawHash };
}

describe('useClaim — build → sign → submit', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('happy path: build, sign, submit, seta claimResult e dispara onClaimed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-c', hashHex: '0xh', balanceId: 'cb-xyz' }))
      .mockResolvedValueOnce(jsonResponse({ claimTxHash: 'claim-tx-1' }));

    const { result, onClaimed, signRawHash } = setup();
    await act(async () => {
      await result.current.doClaim();
    });

    expect(signRawHash).toHaveBeenCalledWith({
      address: onboard.publicKey,
      chainType: 'stellar',
      hash: '0xh',
    });
    expect(result.current.claimResult).toEqual({
      claimTxHash: 'claim-tx-1',
      balanceId: 'cb-xyz',
    });
    expect(onClaimed).toHaveBeenCalledWith('claim-tx-1');
    expect(result.current.claiming).toBe(false);
  });

  it('noop sem stellarClaimableBalanceId', async () => {
    const { result, signRawHash } = setup(
      onRampWith({ stellarClaimableBalanceId: null }),
    );
    await act(async () => {
      await result.current.doClaim();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signRawHash).not.toHaveBeenCalled();
  });

  it('noop sem onRamp', async () => {
    const { result } = setup(null);
    await act(async () => {
      await result.current.doClaim();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha se token Privy ausente', async () => {
    const { result, onError, getAccessToken } = setup();
    getAccessToken.mockResolvedValueOnce(null);
    await act(async () => {
      await result.current.doClaim();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.claimResult).toBeNull();
  });

  it('propaga erro do build', async () => {
    fetchMock.mockResolvedValueOnce(new Response('horizon down', { status: 500 }));
    const { result, onError, onClaimed } = setup();
    await act(async () => {
      await result.current.doClaim();
    });
    expect(onError).toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('propaga erro do submit', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-c', hashHex: '0xh', balanceId: 'cb-xyz' }))
      .mockResolvedValueOnce(new Response('claim falhou', { status: 500 }));
    const { result, onError, onClaimed } = setup();
    await act(async () => {
      await result.current.doClaim();
    });
    expect(onError).toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
    expect(result.current.claimResult).toBeNull();
  });
});
