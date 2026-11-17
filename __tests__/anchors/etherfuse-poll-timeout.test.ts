/**
 * pollOnRampUntilTerminal (sandbox-pay, smokes) tem timeout PRÓPRIO por chamada (20 s), separado dos 4 s do status do on-ramp:
 * uma consulta lenta no meio do poll não pode derrubar a liquidação da demo (achado MÉDIO da Vera). Um estouro isolado de uma
 * chamada conta como "sem resposta neste tick" e o poll segue até o prazo GERAL; só o prazo geral termina o poll.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';

const ORDEM = '3f2a9c1e-7b4d-4e8a-9d11-0a1b2c3d4e5f';
const cliente = () => new EtherfuseClient({ apiKey: 'K', baseUrl: 'https://api.sand.etherfuse.test' });
const ordemJson = (status: string) => new Response(JSON.stringify({ orderId: ORDEM, status, orderType: 'onramp' }), { status: 200 });
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cada chamada do fetch segue o roteiro: 'lenta:N' responde depois de N ms (respeitando o AbortSignal); 'pendurada' só termina no abort. */
function roteiro(passos: string[]) {
  let i = 0;
  const f = vi.fn((_u: unknown, init?: RequestInit) => {
    const passo = passos[Math.min(i++, passos.length - 1)]!;
    return new Promise<Response>((res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
      if (passo === 'pendurada') return;
      const [tipo, v] = passo.split(':');
      if (tipo === 'lenta') void dorme(Number(v)).then(() => res(ordemJson('created')));
      else res(ordemJson(tipo!));
    });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pollOnRampUntilTerminal — timeout próprio por chamada', () => {
  it('o padrão por chamada é 20 s (não os 4 s do status do on-ramp)', async () => {
    const espiao = vi.spyOn(AbortSignal, 'timeout');
    roteiro(['completed']);
    await cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 1 });
    expect(espiao).toHaveBeenCalledWith(20_000);
    expect(espiao).not.toHaveBeenCalledWith(4000);
  });

  it('consulta lenta (acima do que seriam 4 s, aqui escalado) no meio do poll: o poll espera a resposta e conclui', async () => {
    // escala 1:100 para o teste ser rápido: chamada lenta de 120 ms com limite por chamada de 400 ms
    roteiro(['created', 'lenta:120', 'completed']);
    const tx = await cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 1, callTimeoutMs: 400, timeoutMs: 5000 });
    expect(tx.status).toBe('completed');
  });

  it('uma chamada que estoura o limite por chamada NÃO derruba o poll: o tick conta como sem resposta e o poll segue', async () => {
    const f = roteiro(['pendurada', 'completed']);
    const ticks: Array<{ status: string | null; notFound: boolean }> = [];
    const tx = await cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 1, callTimeoutMs: 30, timeoutMs: 5000, onTick: (t) => ticks.push(t) });
    expect(tx.status).toBe('completed');
    expect(f).toHaveBeenCalledTimes(2);
    expect(ticks[0]).toEqual({ status: null, notFound: false }); // estouro ≠ 404
  });

  it('só o prazo GERAL termina o poll: chamadas sempre penduradas → POLL_TIMEOUT (408), nunca ANCHOR_TIMEOUT', async () => {
    roteiro(['pendurada']);
    const err = await cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 1, callTimeoutMs: 30, timeoutMs: 150 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'POLL_TIMEOUT', statusCode: 408 });
  });

  it('erro que NÃO é timeout continua derrubando o poll como antes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'BOOM', message: 'x' } }), { status: 500 })));
    await expect(cliente().pollOnRampUntilTerminal(ORDEM, { intervalMs: 1 })).rejects.toMatchObject({ code: 'BOOM' });
  });

  it('o getOnRampTransaction avulso (status do on-ramp) segue com 4 s', async () => {
    const espiao = vi.spyOn(AbortSignal, 'timeout');
    roteiro(['created']);
    await cliente().getOnRampTransaction(ORDEM);
    expect(espiao).toHaveBeenCalledWith(4000);
  });
});
