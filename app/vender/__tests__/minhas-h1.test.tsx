// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ ready: true, authenticated: true, getAccessToken }) }));

import MinhasSolicitacoes from '@/components/vender/MinhasSolicitacoes';

// U2 A-16: /vender/minhas tinha o título visual mas só <h2>; a página precisa de um <h1> (leitor de tela).
describe('Minhas solicitações: nível do título', () => {
  beforeEach(() => {
    getAccessToken.mockReset().mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ solicitacoes: [] }), { status: 200 })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('na página própria é h1, inclusive sem solicitações', async () => {
    render(<MinhasSolicitacoes />);
    await waitFor(() => expect(screen.queryByText(/Carregando suas solicitações/)).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'Minhas solicitações' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Minhas solicitações' })).toBeNull();
  });

  it('no topo do /vender (compacto) segue h2, para não ter dois h1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ solicitacoes: [{ id: 'cmlead0000aaa111', status: 'OFERTA_ENVIADA', etapa: 3, encerrado: false, concluido: false, criadoEm: '2026-11-14T12:00:00.000Z', atualizadoEm: '2026-11-14T13:00:00.000Z', oferta: null }] }), { status: 200 })));
    render(<MinhasSolicitacoes variante="compacto" />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Minhas solicitações' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
