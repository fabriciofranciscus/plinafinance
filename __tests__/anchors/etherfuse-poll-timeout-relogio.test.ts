/**
 * pollOnRampUntilTerminal (usado pelo sandbox-pay, o botão de pagar da demo) NÃO herda o teto de 4 s da consulta pontual do
 * onramp/status: cada consulta do poll tem teto PRÓPRIO (20 s, limitado ao que resta do prazo do poll), e uma consulta que estoura
 * não encerra o laço (ele segue até o prazo e só então dá POLL_TIMEOUT). Achado da Vera: uma 2ª consulta lenta (> 4 s) derrubava a
 * liquidação com ANCHOR_TIMEOUT, o que na main não acontecia.
 * O relógio é simulado e o AbortSignal.timeout é ligado a ele, então a espera de segundos roda instantânea e sem rede.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';

const ORDEM = '3f2a9c1e-7b4d-4e8a-9d11-0a1b2c3d4e5f';
const cliente = () => new EtherfuseClient({ apiKey: 'CHAVE', baseUrl: 'https://api.sand.etherfuse.test' });
const resposta = (status: string) => new Response(JSON.stringify({ orderId: ORDEM, status, orderType: 'onramp' }), { status: 200 });

/** fetch que responde depois de `ms` (tempo simulado) e rejeita se o signal abortar antes (como a rede real). */
const respondeEm = (ms: number, status: string) => (_u: unknown, init?: RequestInit) =>
  new Promise<Response>((ok, ruim) => {
    const t = setTimeout(() => ok(resposta(status)), ms);
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); ruim(init.signal!.reason); });
  });

const tetos: number[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  tetos.length = 0;
  // AbortSignal.timeout preso ao relógio simulado: abre o signal depois de `ms` de tempo simulado e guarda o teto pedido
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    tetos.push(ms);
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms);
    return c.signal;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pollOnRampUntilTerminal — teto próprio por consulta', () => {
  it('cada consulta do poll usa teto de 20 s (não os 4 s da consulta pontual)', async () => {
    vi.stubGlobal('fetch', vi.fn(respondeEm(0, 'completed')));
    const p = cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(tetos).toEqual([20_000]);
  });

  it('REGRESSÃO da Vera: a 2ª consulta demora 6 s (> 4 s) e o poll CONCLUI (antes: ANCHOR_TIMEOUT e a ordem ficava sem liquidar)', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn((u: unknown, i?: RequestInit) => (++n === 1 ? respondeEm(0, 'created')(u, i) : respondeEm(6000, 'completed')(u, i))));
    const p = cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(2_000 + 6_000 + 100);
    await expect(p).resolves.toMatchObject({ status: 'completed' });
  });

  it('uma consulta que passa do teto NÃO encerra o poll: a próxima conclui', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn((u: unknown, i?: RequestInit) => (++n === 1 ? respondeEm(60_000, 'created')(u, i) : respondeEm(0, 'completed')(u, i))));
    const p = cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(20_000 + 2_000 + 100);
    await expect(p).resolves.toMatchObject({ status: 'completed' });
    expect(n).toBe(2);
  });

  it('o teto da consulta nunca passa do que resta do prazo do poll (não estoura o prazo por uma consulta pendurada)', async () => {
    vi.stubGlobal('fetch', vi.fn(respondeEm(600_000, 'created')));
    const p = cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 8_000 });
    const resultado = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(8_000 + 2_000 + 100);
    expect(tetos[0]).toBeLessThanOrEqual(8_000);
    expect(await resultado).toMatchObject({ code: 'POLL_TIMEOUT', statusCode: 408 });
  });

  it('sem resposta até o prazo: POLL_TIMEOUT (não ANCHOR_TIMEOUT)', async () => {
    vi.stubGlobal('fetch', vi.fn(respondeEm(600_000, 'created')));
    const p = cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 45_000 });
    const resultado = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(45_000 + 25_000);
    expect(await resultado).toMatchObject({ code: 'POLL_TIMEOUT' });
  });

  // Entre o `while (Date.now() < deadline)` e o cálculo do teto passam alguns ms: o que resta pode dar 0 ou negativo. Com 0 o fetch
  // sairia SEM signal (sem limite; `timeoutMs` 0 é falso) e com negativo o AbortSignal.timeout lançaria e abortaria o poll.
  it.each([['resta 0', 6_000], ['resta negativo (passou do prazo no meio)', 6_500]])('no limite do prazo (%s): a consulta sai COM signal de no mínimo 1 s e o poll segue', async (_nome, agoraNoCalculo) => {
    const relogio = vi.spyOn(Date, 'now');
    // chamadas em ordem no poll: 1 = startedAt (1000), 2 = while (5999 < deadline 6000), 3 = cálculo do teto; depois, tempo parado
    relogio.mockReturnValueOnce(1_000).mockReturnValueOnce(5_999).mockReturnValueOnce(agoraNoCalculo).mockReturnValue(agoraNoCalculo);
    const f = vi.fn((_u: unknown, _i?: RequestInit) => Promise.resolve(resposta('completed')));
    vi.stubGlobal('fetch', f);
    await expect(cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 2000, timeoutMs: 5_000 })).resolves.toMatchObject({ status: 'completed' });
    expect(tetos).toEqual([1_000]); // piso de 1 s
    expect(f.mock.calls[0]![1]?.signal).toBeDefined();
  });
});
