// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
const getAccessToken = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

const data: AcompanharData = {
  leadId: 'lead-1',
  cedenteNome: 'Cedente Teste',
  status: 'OFERTA_ENVIADA',
  etapaAtual: 3,
  contextoDescricao: 'Oferta enviada.',
  ofertaId: 'of-1',
  oferta: { valorCarta: 100000, desagioPct: '20.00', valorLiquido: 80000, prazoRestanteMeses: 18, validade: '2026-12-01' },
  cessaoId: null,
  consentTx: null,
  cessaoTx: null,
  pixTx: null,
  temCota: false,
};

describe('aceitar oferta em /vender/acompanhar envia o token do Privy', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    getAccessToken.mockReset();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const aceitar = () => fireEvent.click(screen.getByRole('button', { name: /Aceitar proposta/ }));

  it('manda authorization: Bearer <token> e o ofertaId', async () => {
    getAccessToken.mockResolvedValue('tok-privy-teste');
    render(<AcompanharView data={data} />);
    aceitar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/vender/aceitar-oferta');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tok-privy-teste');
    expect(h['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ ofertaId: 'of-1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('sem sessão (token nulo) não inventa o cabeçalho; o servidor responde 401 e a tela mostra o erro', async () => {
    getAccessToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'token Privy ausente' }), { status: 401 }));
    render(<AcompanharView data={data} />);
    aceitar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('authorization');
    expect(await screen.findByText('token Privy ausente')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('getAccessToken que nunca resolve: sai por timeout de 8 s com mensagem e destrava o botão', async () => {
    vi.useFakeTimers();
    try {
      getAccessToken.mockReturnValue(new Promise(() => {}));
      render(<AcompanharView data={data} />);
      aceitar();
      await vi.advanceTimersByTimeAsync(8100);
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByText('Sessão demorou pra responder. Tente novamente.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
