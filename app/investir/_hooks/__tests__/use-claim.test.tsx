// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnRampData, OnboardData } from '../../_types';
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
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

  describe('E2-3 — XDR expirado é regenerado, nunca submetido', () => {
    const NOW = 1_800_000_000;
    // XDR real com maxTime controlado: o hook lê o prazo do envelope.
    function xdrComMax(maxTime: number): string {
      const kp = Keypair.random();
      return new TransactionBuilder(new Account(kp.publicKey(), '1'), {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: 0, maxTime },
      })
        .addOperation(Operation.bumpSequence({ bumpTo: '10' }))
        .build()
        .toXDR();
    }
    const built = (maxTime: number) => ({
      xdr: xdrComMax(maxTime),
      hashHex: '0xh',
      balanceId: 'cb-xyz',
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW * 1000);
    });
    afterEach(() => vi.useRealTimers());

    it('build devolve XDR já vencido: pede outro build e só assina o novo', async () => {
      const velho = built(NOW - 60);
      const novo = built(NOW + 300);
      fetchMock
        .mockResolvedValueOnce(jsonResponse(velho))
        .mockResolvedValueOnce(jsonResponse(novo))
        .mockResolvedValueOnce(jsonResponse({ claimTxHash: 'claim-tx-2' }));
      const { result, onClaimed, signRawHash } = setup();
      await act(async () => {
        await result.current.doClaim();
      });
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
        '/api/investidor/buy/claim/build',
        '/api/investidor/buy/claim/build',
        '/api/investidor/buy/claim/submit',
      ]);
      expect(signRawHash).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body));
      expect(body.xdr).toBe(novo.xdr);
      expect(result.current.claimRegenerated).toBe(true);
      expect(onClaimed).toHaveBeenCalledWith('claim-tx-2');
    });

    it('build devolve vencido duas vezes: erro, nada assinado nem submetido', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(built(NOW - 60)))
        .mockResolvedValueOnce(jsonResponse(built(NOW - 30)));
      const { result, onError, signRawHash, onClaimed } = setup();
      await act(async () => {
        await result.current.doClaim();
      });
      expect(signRawHash).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalled();
      expect(onClaimed).not.toHaveBeenCalled();
    });

    it('submit 409 XDR_EXPIRADO: refaz o build, reassina uma vez e conclui', async () => {
      const a = built(NOW + 300);
      const b = built(NOW + 600);
      fetchMock
        .mockResolvedValueOnce(jsonResponse(a))
        .mockResolvedValueOnce(jsonResponse({ error: 'expirou', code: 'XDR_EXPIRADO' }, 409))
        .mockResolvedValueOnce(jsonResponse(b))
        .mockResolvedValueOnce(jsonResponse({ claimTxHash: 'claim-tx-3' }));
      const { result, onClaimed, signRawHash, onError } = setup();
      await act(async () => {
        await result.current.doClaim();
      });
      expect(signRawHash).toHaveBeenCalledTimes(2);
      const last = JSON.parse(String((fetchMock.mock.calls[3]![1] as RequestInit).body));
      expect(last.xdr).toBe(b.xdr);
      expect(result.current.claimRegenerated).toBe(true);
      expect(onClaimed).toHaveBeenCalledWith('claim-tx-3');
      expect(onError).not.toHaveBeenCalled();
    });

    it('XDR_EXPIRADO de novo na segunda tentativa: para com mensagem fixa (sem loop)', async () => {
      const exp = jsonResponse({ error: 'expirou', code: 'XDR_EXPIRADO' }, 409);
      fetchMock
        .mockResolvedValueOnce(jsonResponse(built(NOW + 300)))
        .mockResolvedValueOnce(exp)
        .mockResolvedValueOnce(jsonResponse(built(NOW + 600)))
        .mockResolvedValueOnce(jsonResponse({ error: 'expirou', code: 'XDR_EXPIRADO' }, 409));
      const { result, onError, onClaimed } = setup();
      await act(async () => {
        await result.current.doClaim();
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onClaimed).not.toHaveBeenCalled();
    });

    it('outro 409 não regenera: segue o erro normal', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(built(NOW + 300)))
        .mockResolvedValueOnce(jsonResponse({ error: 'já reclamado' }, 409));
      const { result, onError } = setup();
      await act(async () => {
        await result.current.doClaim();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current.claimRegenerated).toBe(false);
      expect(onError).toHaveBeenCalled();
    });
  });
});
