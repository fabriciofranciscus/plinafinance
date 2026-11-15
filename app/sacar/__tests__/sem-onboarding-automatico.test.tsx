// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
let sessao: { ready: boolean; authenticated: boolean } = { ready: true, authenticated: true };
vi.mock('@/lib/hooks/privy', () => ({
  useAppPrivy: () => ({ ...sessao, getAccessToken, login: vi.fn() }),
  useAppSignRawHash: () => ({ signRawHash: vi.fn() }),
}));

import SacarPage from '../page';

const onboardCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/investidor/onboard'));

describe('/sacar: o onboarding (carteira + cadastro Etherfuse) só roda com o clique', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessao = { ready: true, authenticated: true };
    getAccessToken.mockReset().mockResolvedValue('tok-teste');
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('logado, ao abrir: mostra o aviso e o botão "Continuar" e NÃO chama o onboard', async () => {
    render(<SacarPage />);
    expect(screen.getByTestId('sacar-preparar')).toBeTruthy();
    expect(screen.getByText(/Se ela ainda não existir, será criada agora, em rede de testes/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(onboardCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('só depois do clique em "Continuar" chama o onboard, uma vez, com o Bearer', async () => {
    render(<SacarPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(onboardCalls(fetchMock)).toHaveLength(1));
    const init = onboardCalls(fetchMock)[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-teste');
  });

  it('se o onboard falha, o botão volta e permite tentar de novo (nova chamada só com novo clique)', async () => {
    render(<SacarPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(onboardCalls(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('sacar-preparar')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(onboardCalls(fetchMock)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(onboardCalls(fetchMock)).toHaveLength(2));
  });

  it('deslogado: pede login e não chama nada', async () => {
    sessao = { ready: true, authenticated: false };
    render(<SacarPage />);
    expect(screen.getByRole('button', { name: /Entrar com Privy/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
