import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from '@/lib/http/client';

describe('postJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lança "Sessão Privy expirada." quando não há token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      postJson('/api/x', { a: 1 }, async () => null),
    ).rejects.toThrow('Sessão Privy expirada.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lança o texto do erro do server quando !res.ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('detalhe do erro', { status: 400 }),
    );
    await expect(
      postJson('/api/x', { a: 1 }, async () => 'tok'),
    ).rejects.toThrow('detalhe do erro');
  });

  it('manda Bearer + JSON e retorna o json parseado quando ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, n: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const data = await postJson<{ ok: boolean; n: number }>(
      '/api/x',
      { a: 1 },
      async () => 'tok',
    );
    expect(data).toEqual({ ok: true, n: 42 });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/x');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
  });
});
