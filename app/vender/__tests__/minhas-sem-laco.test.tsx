// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O stub do Privy devolve um getAccessToken NOVO a cada renderização (Vera/Íris): antes isso refazia o GET sem fim.
let renders = 0;
vi.mock('@/lib/hooks/privy', () => ({
  useAppPrivy: () => {
    renders++;
    return { ready: true, authenticated: true, getAccessToken: async () => `tok-${renders}` };
  },
}));

import MinhasSolicitacoes from '@/components/vender/MinhasSolicitacoes';

describe('Minhas solicitações não entra em laço de GET quando o getAccessToken muda a cada render', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    renders = 0;
    fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ solicitacoes: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('um único GET, mesmo com várias renderizações', async () => {
    const { rerender } = render(<MinhasSolicitacoes />);
    await screen.findByText(/Você ainda não tem solicitações/);
    for (let i = 0; i < 5; i++) await act(async () => rerender(<MinhasSolicitacoes />));
    await new Promise((r) => setTimeout(r, 50));
    expect(renders).toBeGreaterThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('o token enviado é o mais recente (a referência acompanha a função nova)', async () => {
    render(<MinhasSolicitacoes />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const auth = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(auth.authorization).toMatch(/^Bearer tok-\d+$/);
  });
});
