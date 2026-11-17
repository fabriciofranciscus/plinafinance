/**
 * getOnRampTransaction (status do on-ramp) tem TIMEOUT próprio (~4 s, AbortSignal): sem ele a janela de 5 s da trava por ordem não
 * impede duas consultas sobrepostas quando a Etherfuse demora. SÓ esse método ganha o timeout (os demais ficam como estavam).
 * Falha por tempo = AnchorError ANCHOR_TIMEOUT com mensagem fixa (sem URL, id da ordem nem chave).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { AnchorError } from '@/lib/anchors/types';

const ORDEM = '3f2a9c1e-7b4d-4e8a-9d11-0a1b2c3d4e5f';
const cliente = () => new EtherfuseClient({ apiKey: 'CHAVE_SECRETA', baseUrl: 'https://api.sand.etherfuse.test' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** fetch que nunca responde e só termina quando o AbortSignal dispara (como a rede real parada). */
function fetchPendurado() {
  return vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('EtherfuseClient.getOnRampTransaction — timeout', () => {
  it('Etherfuse que não responde: rejeita com ANCHOR_TIMEOUT (504) dentro do prazo, mensagem fixa', async () => {
    vi.stubGlobal('fetch', fetchPendurado());
    const t0 = Date.now();
    const err = await cliente().getOnRampTransaction(ORDEM, { timeoutMs: 40 }).catch((e) => e);
    expect(err).toBeInstanceOf(AnchorError);
    expect(err).toMatchObject({ code: 'ANCHOR_TIMEOUT', statusCode: 504 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(err.message).not.toMatch(new RegExp(`${ORDEM}|CHAVE_SECRETA|etherfuse\\.test`));
  });

  it('o padrão é ~4 s (AbortSignal.timeout(4000)) e o fetch recebe o signal', async () => {
    const espiao = vi.spyOn(AbortSignal, 'timeout');
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => json(200, { orderId: ORDEM, status: 'created', orderType: 'onramp' }));
    vi.stubGlobal('fetch', f);
    await cliente().getOnRampTransaction(ORDEM).catch(() => undefined);
    expect(espiao).toHaveBeenCalledWith(4000);
    expect(f.mock.calls[0]![1]?.signal).toBeDefined();
  });

  it('resposta rápida: sem mudança de comportamento (404 continua null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: { code: 'NOT_FOUND', message: 'x' } })));
    expect(await cliente().getOnRampTransaction(ORDEM)).toBeNull();
  });

  it('erro HTTP que não é timeout continua AnchorError com o código do upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: { code: 'BOOM', message: 'falhou' } })));
    await expect(cliente().getOnRampTransaction(ORDEM)).rejects.toMatchObject({ code: 'BOOM', statusCode: 500 });
  });

  it('SÓ esse método tem o timeout: outro método do cliente chama o fetch SEM signal', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => json(200, { items: [] }));
    vi.stubGlobal('fetch', f);
    await cliente().getFiatAccounts('cust_1').catch(() => undefined);
    expect(f.mock.calls[0]![1]?.signal).toBeUndefined();
  });
});
