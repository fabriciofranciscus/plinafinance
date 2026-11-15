// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
let sessao = { ready: true, authenticated: true };
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ ...sessao, getAccessToken }) }));

import MinhasSolicitacoes, { idCurtoSolicitacao, rotuloDaEtapa } from '@/components/vender/MinhasSolicitacoes';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'cmlead0000aaa111',
  status: 'OFERTA_ENVIADA',
  etapa: 3,
  encerrado: false,
  concluido: false,
  criadoEm: '2026-11-14T12:00:00.000Z',
  atualizadoEm: '2026-11-14T13:00:00.000Z',
  oferta: { status: 'ENVIADA', tipoBem: 'IMOVEL', valorCarta: '150000.00', valorLiquido: '120000.00', validade: '2026-11-16T12:00:00.000Z' },
  ...over,
});
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Minhas solicitações (GET /api/vender/minhas)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessao = { ready: true, authenticated: true };
    getAccessToken.mockReset().mockResolvedValue('tok-teste');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('chama o endpoint com Bearer e lista cada item com link para /vender/acompanhar/<id>', async () => {
    fetchMock.mockResolvedValue(resp({ solicitacoes: [item(), item({ id: 'cmlead0000bbb222', oferta: null, etapa: 2 })] }));
    render(<MinhasSolicitacoes />);
    const links = await screen.findAllByRole('link');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/vender/minhas');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-teste' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/vender/acompanhar/cmlead0000aaa111',
      '/vender/acompanhar/cmlead0000bbb222',
    ]);
    expect(links[0]!.textContent).toContain('Solicitação #AAA111');
    expect(links[0]!.textContent).toMatch(/Etapa atual: Proposta de preço/);
    expect(links[0]!.textContent).toMatch(/Imóvel · carta R\$\s150\.000,00 · valor líquido da proposta R\$\s120\.000,00/);
    expect(links[1]!.textContent).toContain('Proposta ainda não enviada');
  });

  it('lista vazia (pré-KYC ou sem solicitação): estado vazio com link para /vender', async () => {
    fetchMock.mockResolvedValue(resp({ solicitacoes: [] }));
    render(<MinhasSolicitacoes />);
    expect(await screen.findByText(/Você ainda não tem solicitações/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Venda sua cota contemplada/ }).getAttribute('href')).toBe('/vender');
  });

  it('erro do servidor: mensagem fixa (sem o texto do servidor) e "Tentar de novo" que refaz a chamada', async () => {
    fetchMock.mockResolvedValueOnce(resp({ error: 'erro interno detalhado' }, 500)).mockResolvedValueOnce(resp({ solicitacoes: [item()] }));
    render(<MinhasSolicitacoes />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar suas solicitações agora.');
    expect(alerta.textContent).not.toContain('detalhado');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Solicitação #AAA111/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sem sessão: não chama o endpoint', async () => {
    sessao = { ready: true, authenticated: false };
    render(<MinhasSolicitacoes />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('compacto: mostra até 3 com "Ver todas"; vazio e erro ficam em silêncio', async () => {
    const quatro = ['a', 'b', 'c', 'd'].map((x) => item({ id: `cmlead000${x}${x}${x}111` }));
    fetchMock.mockResolvedValue(resp({ solicitacoes: quatro }));
    const u = render(<MinhasSolicitacoes variante="compacto" />);
    await waitFor(() => expect(screen.getAllByText(/Solicitação #/)).toHaveLength(3));
    expect(screen.getByRole('link', { name: /Ver todas \(4\)/ }).getAttribute('href')).toBe('/vender/minhas');
    u.unmount();
    fetchMock.mockResolvedValue(resp({ solicitacoes: [] }));
    const v = render(<MinhasSolicitacoes variante="compacto" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(v.container.textContent).toBe('');
    v.unmount();
    fetchMock.mockResolvedValue(resp({ error: 'x' }, 500));
    const w = render(<MinhasSolicitacoes variante="compacto" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(w.container.textContent).toBe('');
  });

  it('rótulos: encerrada, concluída e id curto igual ao do /admin', () => {
    expect(rotuloDaEtapa({ status: 'PERDIDO', etapa: -1, encerrado: true, concluido: false })).toBe('Solicitação encerrada');
    expect(rotuloDaEtapa({ status: 'COTA_INCORPORADA', etapa: 6, encerrado: false, concluido: true })).toBe('Todas as etapas concluídas');
    expect(rotuloDaEtapa({ status: 'OFERTA_ACEITA', etapa: 4, encerrado: false, concluido: false })).toBe('Etapa atual: Cessão digital');
    // A-26: Pix pago sem incorporação NÃO é concluído (mesmo com o `concluido: true` do servidor)
    expect(rotuloDaEtapa({ status: 'PIX_EXECUTADO', etapa: 6, encerrado: false, concluido: true })).toBe('Etapa atual: Pagamento enviado');
    expect(idCurtoSolicitacao('cmabcdef123456ZZ99')).toBe('56ZZ99');
  });
});
