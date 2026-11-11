// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResgate } from '../use-resgate';

const signedCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/app/investir/_lib/signed-xdr', () => ({
  attachInvestorSignature: (...a: unknown[]) => {
    signedCalls.push(a);
    return 'signed-1';
  },
}));

const BUILD = {
  quoteId: 'q-1',
  xdr: 'xdr-1',
  hashHex: '0xabc',
  amountPlinarf: '100.0000000',
  brlEquivalente: '104.1700000',
  navPorTokenNaCotacao: '1.04170000',
  expiresAt: '2026-11-11T20:00:00Z',
};
const ADDR = 'GA'.padEnd(56, 'A');
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

describe('useResgate (contrato E2-4)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    signedCalls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const signRawHash = vi.fn().mockResolvedValue({ signature: '0xfeed' });
    const onDone = vi.fn();
    const { result } = renderHook(() =>
      useResgate({ stellarAddress: ADDR, signRawHash, getAccessToken: async () => 'tk', onDone }),
    );
    return { result, signRawHash, onDone };
  }

  it('build com { amountPlinarf }, assina o hashHex, submete só { quoteId, signedXdr }', async () => {
    fetchMock.mockResolvedValueOnce(json(BUILD)).mockResolvedValueOnce(json({ txHash: 'tx-9' }));
    const { result, signRawHash, onDone } = setup();
    act(() => result.current.setAmount('100'));
    await act(async () => result.current.gerarCotacao());
    expect(result.current.build).toEqual(BUILD);
    expect(result.current.passo).toBe('ready');
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/investidor/liquidar/build');
    expect(JSON.parse(String(init.body))).toEqual({ amountPlinarf: '100' });

    await act(async () => result.current.confirmar());
    await flush();
    expect(signRawHash).toHaveBeenCalledWith({ address: ADDR, chainType: 'stellar', hash: '0xabc' });
    expect(signedCalls).toEqual([['xdr-1', ADDR, '0xfeed']]);
    [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/investidor/liquidar/submit');
    expect(JSON.parse(String(init.body))).toEqual({ quoteId: 'q-1', signedXdr: 'signed-1' });
    expect(result.current.passo).toBe('done');
    expect(result.current.txHash).toBe('tx-9');
    expect(onDone).toHaveBeenCalled();
  });

  it('409 NAV_MUDOU e 410: pedem nova cotação (limpam o quote), sem texto cru', async () => {
    for (const [status, body, tipo] of [
      [409, { error: 'x', code: 'NAV_MUDOU' }, 'nav_mudou'],
      [410, { error: 'expirado' }, 'cotacao_expirada'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json(BUILD)).mockResolvedValueOnce(json(body, status));
      const { result } = setup();
      act(() => result.current.setAmount('100'));
      await act(async () => result.current.gerarCotacao());
      await act(async () => result.current.confirmar());
      await flush();
      expect(result.current.erro?.tipo).toBe(tipo);
      expect(result.current.build).toBeNull();
      expect(result.current.passo).toBe('idle');
      expect(result.current.txHash).toBeNull();
    }
  });

  it('409 CONFLICT pede nova cotação; 503 LEDGER_UNAVAILABLE e 422 CLASSE_INDISPONIVEL são "indisponível" (mantêm a cotação)', async () => {
    fetchMock.mockResolvedValueOnce(json(BUILD)).mockResolvedValueOnce(json({ error: 'x', code: 'CONFLICT' }, 409));
    const a = setup();
    act(() => a.result.current.setAmount('100'));
    await act(async () => a.result.current.gerarCotacao());
    await act(async () => a.result.current.confirmar());
    await flush();
    expect(a.result.current.erro?.tipo).toBe('conflito');
    expect(a.result.current.build).toBeNull();
    for (const [status, code] of [[503, 'LEDGER_UNAVAILABLE'], [422, 'CLASSE_INDISPONIVEL']] as const) {
      fetchMock.mockResolvedValueOnce(json({ error: 'x', code }, status));
      const b = setup();
      act(() => b.result.current.setAmount('100'));
      await act(async () => b.result.current.gerarCotacao());
      expect(b.result.current.erro).toEqual({ tipo: 'indisponivel', codigo: code, fase: 'build' });
    }
  });

  it('409 LIQUIDEZ_INSUFICIENTE (build ou submit): mensagem própria, limpa a cotação e mantém a quantidade para tentar um valor menor', async () => {
    // no build
    fetchMock.mockResolvedValueOnce(json({ error: 'x', code: 'LIQUIDEZ_INSUFICIENTE' }, 409));
    const a = setup();
    act(() => a.result.current.setAmount('1000'));
    await act(async () => a.result.current.gerarCotacao());
    expect(a.result.current.erro).toEqual({ tipo: 'sem_liquidez', codigo: 'LIQUIDEZ_INSUFICIENTE', fase: 'build' });
    expect(a.result.current.amount).toBe('1000');
    expect(a.result.current.passo).toBe('idle');
    // revalidado no submit
    fetchMock.mockResolvedValueOnce(json(BUILD)).mockResolvedValueOnce(json({ error: 'x', code: 'LIQUIDEZ_INSUFICIENTE' }, 409));
    const b = setup();
    act(() => b.result.current.setAmount('100'));
    await act(async () => b.result.current.gerarCotacao());
    await act(async () => b.result.current.confirmar());
    await flush();
    expect(b.result.current.erro?.tipo).toBe('sem_liquidez');
    expect(b.result.current.erro?.fase).toBe('submit');
    expect(b.result.current.build).toBeNull();
    expect(b.result.current.txHash).toBeNull();
  });

  it('409 SWAP_EM_CONFERENCIA: bloqueio próprio, mantém a cotação', async () => {
    fetchMock.mockResolvedValueOnce(json(BUILD)).mockResolvedValueOnce(json({ error: 'x', code: 'SWAP_EM_CONFERENCIA' }, 409));
    const { result } = setup();
    act(() => result.current.setAmount('100'));
    await act(async () => result.current.gerarCotacao());
    await act(async () => result.current.confirmar());
    await flush();
    expect(result.current.erro).toEqual({ tipo: 'em_conferencia', codigo: 'SWAP_EM_CONFERENCIA', fase: 'submit' });
    expect(result.current.passo).toBe('ready');
  });

  it('erro desconhecido: tipo genérico com o código separado (nunca o texto cru)', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'stack trace secreto' }, 500));
    const { result } = setup();
    act(() => result.current.setAmount('100'));
    await act(async () => result.current.gerarCotacao());
    expect(result.current.erro).toEqual({ tipo: 'generico', codigo: 'HTTP_500', fase: 'build' });
    expect(JSON.stringify(result.current.erro)).not.toMatch(/stack/);
  });

  it('recotar depois de NAV_MUDOU refaz o build e usa o quoteId novo', async () => {
    fetchMock
      .mockResolvedValueOnce(json(BUILD))
      .mockResolvedValueOnce(json({ error: 'x', code: 'NAV_MUDOU' }, 409))
      .mockResolvedValueOnce(json({ ...BUILD, quoteId: 'q-2' }))
      .mockResolvedValueOnce(json({ txHash: 'tx-2' }));
    const { result } = setup();
    act(() => result.current.setAmount('100'));
    await act(async () => result.current.gerarCotacao());
    await act(async () => result.current.confirmar());
    await flush();
    await act(async () => result.current.gerarCotacao());
    await act(async () => result.current.confirmar());
    await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[3] as [string, RequestInit])[1].body)).quoteId).toBe('q-2');
    expect(result.current.passo).toBe('done');
  });
});
