// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let renders = 0;
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({
  useAppPrivy: () => {
    renders++;
    return { ready: true, authenticated: true, getAccessToken: async () => `tok-${renders}` };
  },
}));

import AcompanharPrivado from '@/components/vender/AcompanharPrivado';

describe('AcompanharPrivado não entra em laço de GET quando o getAccessToken muda a cada render', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    renders = 0;
    fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: 'não encontrado' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it('um único GET, mesmo com várias renderizações', async () => {
    const { rerender } = render(<AcompanharPrivado leadId="abc" />);
    await screen.findByText(/Solicitação não encontrada neste login/);
    for (let i = 0; i < 5; i++) await act(async () => rerender(<AcompanharPrivado leadId="abc" />));
    await new Promise((r) => setTimeout(r, 50));
    expect(renders).toBeGreaterThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
