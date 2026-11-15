// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const refresh = vi.fn();
const getAccessToken = vi.fn();
let sessao = { ready: true, authenticated: true };
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ ...sessao, getAccessToken }) }));

import AcompanharPrivado, { paraAcompanharData } from '@/components/vender/AcompanharPrivado';

const detalhe = (over: Record<string, unknown> = {}) => ({
  leadId: 'cmlead00000a1b2c3', status: 'OFERTA_ACEITA', etapaAtual: 4, encerrado: false, contextoDescricao: 'Texto do contexto.',
  cedenteNome: 'Cedente Teste', ofertaId: 'o1',
  oferta: { valorCarta: '150000.00', desagioPct: '20.0', valorLiquido: '120000.00', prazoRestanteMeses: 0, validade: '2026-12-01T12:00:00.000Z' },
  cessaoId: 'c1', consentTx: null, cessaoTx: null, pixTx: null, temCota: false, aguardandoAssinatura: false, ...over,
});
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AcompanharPrivado (item 19): o detalhe só chega com o token do dono', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessao = { ready: true, authenticated: true };
    getAccessToken.mockReset().mockResolvedValue('tok-dono');
    refresh.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('com sessão: chama a rota com o Bearer e mostra o detalhe (nome e cessão da etapa)', async () => {
    fetchMock.mockResolvedValue(resp(detalhe()));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    expect(await screen.findByText(/Cedente: Cedente Teste/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/vender/acompanhar/cmlead00000a1b2c3');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-dono');
  });

  it('sem sessão: não chama a rota; pede login e volta para esta página', async () => {
    sessao = { ready: true, authenticated: false };
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    const botao = await screen.findByRole('link', { name: 'Entrar para ver os detalhes' });
    expect(botao.getAttribute('href')).toBe('/entrar?next=%2Fvender%2Facompanhar%2Fcmlead00000a1b2c3');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404 (outra pessoa, id inexistente ou pré-cadastro): "Solicitação não encontrada neste login."; nenhum dado', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'não encontrado' }, 404));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Solicitação não encontrada neste login.');
    expect(screen.queryByText(/Cedente:/)).toBeNull();
    expect(screen.getByRole('link', { name: /Ver minhas solicitações/ }).getAttribute('href')).toBe('/vender/minhas');
  });

  it('401 do servidor: volta ao pedido de login', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'unauthorized' }, 401));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    expect(await screen.findByTestId('acompanhar-sem-sessao')).toBeTruthy();
  });

  it('erro de rede/500: mensagem fixa e "Tentar de novo" que refaz a chamada', async () => {
    fetchMock.mockResolvedValueOnce(resp({ error: 'erro interno' }, 500)).mockResolvedValueOnce(resp(detalhe()));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar a solicitação agora.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Cedente: Cedente Teste/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('solicitação encerrada: mostra o texto do servidor, sem a view de etapas', async () => {
    fetchMock.mockResolvedValue(resp(detalhe({ encerrado: true, status: 'PERDIDO', etapaAtual: -1, contextoDescricao: 'Esta solicitação foi encerrada.', oferta: null })));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    expect(await screen.findByText('Esta solicitação foi encerrada.')).toBeTruthy();
    expect(screen.queryByText(/Cedente:/)).toBeNull();
  });

  it('aceitar a proposta recarrega o detalhe pela rota (não só router.refresh)', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(detalhe({ status: 'OFERTA_ENVIADA', etapaAtual: 3 })))
      .mockResolvedValueOnce(resp({ ok: true })) // aceitar-oferta
      .mockResolvedValueOnce(resp(detalhe({ status: 'OFERTA_ACEITA', etapaAtual: 4 })));
    render(<AcompanharPrivado leadId="cmlead00000a1b2c3" />);
    fireEvent.click(await screen.findByRole('button', { name: /Aceitar oferta|Aceitar proposta/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/vender/aceitar-oferta');
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/vender/acompanhar/cmlead00000a1b2c3');
  });
});

describe('paraAcompanharData', () => {
  it('só converte texto em número para exibir (sem recalcular): valores, deságio e validade', () => {
    const a = paraAcompanharData(detalhe() as never);
    expect(a.oferta).toMatchObject({ valorCarta: 150000, valorLiquido: 120000, desagioPct: '20.0', prazoRestanteMeses: 0 });
    expect(typeof a.oferta!.validade).toBe('string');
    expect(a.cedenteNome).toBe('Cedente Teste');
  });
});

describe('página pública /vender/acompanhar/[leadId]', () => {
  const src = readFileSync('app/vender/acompanhar/[leadId]/page.tsx', 'utf8');
  it('não consulta o banco direto nem monta dados pessoais: usa só acompanharPublico', () => {
    expect(src).not.toMatch(/from '@\/lib\/db'/);
    expect(src).not.toMatch(/nomeDoCedente|valorLiquidoVendedor|stellarTxHash/);
    expect(src).toContain("acompanharPublico");
  });
  it('Referrer-Policy no-referrer e noindex pelos metadados', () => {
    expect(src).toMatch(/referrer: 'no-referrer'/);
    expect(src).toMatch(/robots: \{ index: false/);
  });
  it('/cessao/[id]/comprovante também sai com no-referrer e noindex (Argus, LOW)', () => {
    const c = readFileSync('app/cessao/[id]/comprovante/page.tsx', 'utf8');
    expect(c).toMatch(/referrer: 'no-referrer'/);
    expect(c).toMatch(/robots: \{ index: false/);
  });
});
