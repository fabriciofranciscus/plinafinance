// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { VendedorPipeline } from '../vendedor-pipeline';

const semOferta = [
  { id: 'l1', nome: 'Cedente de teste', email: 'c@exemplo.test', status: 'DOCS_RECEBIDOS', criadoEm: '2026-11-15T00:00:00Z', ofertas: [] },
];

describe('gerar-oferta: tipos do corpo contra o schema da rota', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const preencher = (prazo: string) => {
    render(<VendedorPipeline leads={semOferta} />);
    const c = document.querySelector('form')!;
    const set = (name: string, value: string) =>
      fireEvent.change(c.querySelector(`[name="${name}"]`)!, { target: { value } });
    set('valorCarta', '150000');
    set('administradora', 'Caixa');
    set('desagioAquisicao', '0.20');
    if (prazo) set('prazoRestanteMeses', prazo);
    fireEvent.submit(c);
  };
  const corpo = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));

  it('prazo preenchido vai como NÚMERO inteiro (z.number().int()); valores monetários seguem string numérica', async () => {
    preencher('18');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const b = corpo();
    expect(b.action).toBe('gerar-oferta');
    expect(b.prazoRestanteMeses).toBe(18);
    expect(typeof b.prazoRestanteMeses).toBe('number');
    expect(b.valorCarta).toBe('150000');
    expect(b.desagioAquisicao).toBe('0.20');
    expect(b.validadeHoras).toBe(48);
    expect(typeof b.validadeHoras).toBe('number');
  });

  it('prazo vazio: o campo não é enviado (opcional), em vez de string vazia ou 0', async () => {
    preencher('');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).not.toHaveProperty('prazoRestanteMeses');
  });

  it('o campo aceita só inteiros de 1 a 600, como o schema', () => {
    render(<VendedorPipeline leads={semOferta} />);
    const el = document.querySelector('[name="prazoRestanteMeses"]') as HTMLInputElement;
    expect([el.min, el.max, el.step]).toEqual(['1', '600', '1']);
  });
});
