// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let renders = 0;
vi.mock('@/lib/hooks/privy', () => ({
  useAppPrivy: () => {
    renders++;
    return { ready: true, authenticated: true, getAccessToken: async () => `tok-${renders}` };
  },
}));

import { useMe } from '@/components/me/useMe';
import { useHistorico } from '@/components/me/useHistorico';

describe('/api/me/*: useMe e useHistorico não entram em laço de GET quando o getAccessToken muda a cada render', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    renders = 0;
    fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ itens: [], proximoCursor: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('useMe: um único GET', async () => {
    const { rerender } = renderHook(() => useMe('/api/me/resumo'));
    for (let i = 0; i < 5; i++) await act(async () => rerender());
    await new Promise((r) => setTimeout(r, 50));
    expect(renders).toBeGreaterThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('useHistorico: um único GET', async () => {
    const { rerender } = renderHook(() => useHistorico(null));
    for (let i = 0; i < 5; i++) await act(async () => rerender());
    await new Promise((r) => setTimeout(r, 50));
    expect(renders).toBeGreaterThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
