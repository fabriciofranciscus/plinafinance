// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardData } from '../../_types';
import { useTrustlines } from '../use-trustlines';

const onboard: OnboardData = {
  investidorId: 'inv-1',
  publicKey: 'GA'.padEnd(56, 'A'),
  etherfuseCustomerId: 'cust-1',
  kycStatus: 'approved',
  fundedNow: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup() {
  const onError = vi.fn();
  const clearError = vi.fn();
  const getAccessToken = vi.fn().mockResolvedValue('tkn');
  const signRawHash = vi.fn().mockResolvedValue({ signature: '0xsig' });
  const { result } = renderHook(() =>
    useTrustlines({ onboard, signRawHash, getAccessToken, onError, clearError }),
  );
  return { result, onError, clearError, getAccessToken, signRawHash };
}

describe('useTrustlines — sequência PLINARF → TESOURO', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('executa build→sign→submit PLINARF e depois TESOURO, marcando ready=true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-p', hashHex: '0xhp' })) // plinarf build
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // plinarf submit
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-t', hashHex: '0xht' })) // tesouro build
      .mockResolvedValueOnce(jsonResponse({ ok: true })); // tesouro submit

    const { result, signRawHash } = setup();
    await act(async () => {
      await result.current.setupTrustlines();
    });

    // 4 fetches na ordem certa
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      '/api/investidor/buy/trust-plinarf/build',
      '/api/investidor/buy/trust-plinarf/submit',
      '/api/investidor/buy/trust-tesouro/build',
      '/api/investidor/buy/trust-tesouro/submit',
    ]);

    // signRawHash chamado uma vez por trustline com hash correspondente
    expect(signRawHash).toHaveBeenNthCalledWith(1, {
      address: onboard.publicKey,
      chainType: 'stellar',
      hash: '0xhp',
    });
    expect(signRawHash).toHaveBeenNthCalledWith(2, {
      address: onboard.publicKey,
      chainType: 'stellar',
      hash: '0xht',
    });

    expect(result.current.trustlinesReady).toBe(true);
    expect(result.current.trustlineLoading).toBe(false);
  });

  it('aborta se PLINARF build devolve resposta sem xdr/hashHex (PR #5 hardening)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-p' })); // sem hashHex

    const { result, onError, signRawHash } = setup();
    await act(async () => {
      await result.current.setupTrustlines();
    });

    expect(onError).toHaveBeenCalled();
    const err = onError.mock.calls[0][0];
    expect(err.technical).toContain('hashHex');
    expect(signRawHash).not.toHaveBeenCalled();
    expect(result.current.trustlinesReady).toBe(false);
  });

  it('aborta se PLINARF submit falha — não tenta TESOURO', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-p', hashHex: '0xhp' }))
      .mockResolvedValueOnce(new Response('stellar horizon down', { status: 500 }));

    const { result, onError } = setup();
    await act(async () => {
      await result.current.setupTrustlines();
    });

    expect(onError).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // não chegou no tesouro
    expect(result.current.trustlinesReady).toBe(false);
  });

  it('idempotência: noop se trustlinesReady já é true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-p', hashHex: '0xhp' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ xdr: 'xdr-t', hashHex: '0xht' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { result } = setup();
    await act(async () => {
      await result.current.setupTrustlines();
    });
    expect(result.current.trustlinesReady).toBe(true);

    fetchMock.mockClear();
    await act(async () => {
      await result.current.setupTrustlines();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('noop se onboard=null', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useTrustlines({
        onboard: null,
        signRawHash: vi.fn(),
        getAccessToken: vi.fn().mockResolvedValue('t'),
        onError,
        clearError: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.setupTrustlines();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
