// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { VendedorPipeline } from '../vendedor-pipeline';

type Props = Parameters<typeof VendedorPipeline>[0];
type Cessao = NonNullable<Props['leads'][number]['ofertas'][number]['cessao']>;

function leads(cessao: Partial<Cessao> | null): Props['leads'] {
  return [
    {
      id: 'l1',
      nome: 'Cedente de teste',
      email: 'cedente@exemplo.test',
      status: 'OFERTA_ACEITA',
      criadoEm: '2026-11-13T12:00:00Z',
      ofertas: [
        {
          id: 'o1',
          versao: 1,
          tipoBem: 'IMOVEL',
          valorCarta: '100000',
          valorLiquidoVendedor: '80000',
          desagioAquisicao: '0.2',
          administradora: 'Administradora',
          status: 'ACEITA',
          validade: '2026-12-01T00:00:00Z',
          cessao: cessao
            ? { id: 'c1', status: 'PENDENTE', onChainTxHash: null, pagamento: null, cota: null, ...cessao }
            : null,
        },
      ],
    },
  ];
}

describe('VendedorPipeline: fluxo da cota de prova', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const corpo = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]![1] as RequestInit).body));

  it('oferta aceita sem cessão: o botão só registra a cessão', async () => {
    render(<VendedorPipeline leads={leads(null)} />);
    fireEvent.click(screen.getByRole('button', { name: /Registrar cessão/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'registrar-cessao', ofertaId: 'o1' });
  });

  it('PENDENTE sem laudo: pede a URL com #sha256; não oferece envio nem pagamento', async () => {
    render(<VendedorPipeline leads={leads({ laudoRegistrado: false })} />);
    expect(screen.queryByRole('button', { name: /Enviar para assinatura/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pagar cedente/ })).toBeNull();
    const botao = screen.getByRole('button', { name: 'Registrar laudo' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/laudo\.pdf#sha256/), {
      target: { value: 'https://exemplo.test/laudo.pdf#sha256=abc' },
    });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({
      action: 'registrar-laudo',
      cessaoId: 'c1',
      laudoUrl: 'https://exemplo.test/laudo.pdf#sha256=abc',
    });
  });

  it('com laudo registrado: envia à assinatura (enviar-cessao)', async () => {
    render(<VendedorPipeline leads={leads({ laudoRegistrado: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /Enviar para assinatura/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'enviar-cessao', cessaoId: 'c1' });
  });

  it('ENVIADA_DOCUSIGN: aguarda e sincroniza (sincronizar-cessoes)', async () => {
    render(<VendedorPipeline leads={leads({ status: 'ENVIADA_DOCUSIGN', laudoRegistrado: true })} />);
    expect(screen.getByText(/Aguardando assinatura do cedente/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sincronizar assinatura/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'sincronizar-cessoes', cessaoId: 'c1' });
  });

  it('ASSINADA sem titular confirmado: exige o atestado; ainda sem pagar', async () => {
    render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: null })} />);
    expect(screen.queryByRole('button', { name: /Pagar cedente/ })).toBeNull();
    const confirmar = screen.getByRole('button', { name: /Confirmar titular do laudo/ }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({
      action: 'confirmar-titular-laudo',
      cessaoId: 'c1',
      situacao: 'TITULAR_UNICO',
      atestado: true,
    });
  });

  it('titular único confirmado: paga o cedente (pagar-cedente); nunca o Pix simulado avulso', async () => {
    render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO' })} />);
    expect(screen.queryByRole('button', { name: /Executar Pix simulado/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Pagar cedente/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'pagar-cedente', cessaoId: 'c1' });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('executar-pix-simulado');
  });

  it('espólio, cotitularidade e procurador: tratamento manual, sem botão de pagar', () => {
    for (const s of ['ESPOLIO', 'COTITULARIDADE', 'PROCURADOR']) {
      const { unmount } = render(
        <VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: s })} />,
      );
      expect(screen.queryByRole('button', { name: /Pagar cedente/ })).toBeNull();
      expect(screen.getByText(/tratamento manual/)).toBeTruthy();
      unmount();
    }
  });

  it('pagamento executado sem cota: incorpora ao pool (incorporar-cota)', async () => {
    render(
      <VendedorPipeline
        leads={leads({
          status: 'ASSINADA',
          laudoRegistrado: true,
          titularSituacao: 'TITULAR_UNICO',
          pixStatus: 'COMPROVADA',
          laudoHash: 'a'.repeat(64),
          anuenciaStatus: 'DECLARADA_PENDENTE',
          pagamento: { id: 'p1', status: 'EXECUTADO', onChainTxHash: null },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Incorporar cota ao pool/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'incorporar-cota', cessaoId: 'c1' });
  });

  it('registra a anuência com o hash do laudo; incorporar fica bloqueado sem ela', async () => {
    const hash = 'b'.repeat(64);
    const base = { status: 'ASSINADA', laudoRegistrado: true, laudoHash: hash, titularSituacao: 'TITULAR_UNICO', pixStatus: 'COMPROVADA', pagamento: { id: 'p1', status: 'EXECUTADO', onChainTxHash: null } };
    const { unmount } = render(<VendedorPipeline leads={leads(base)} />);
    expect((screen.getByRole('button', { name: /Incorporar cota ao pool/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar anuência' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'registrar-anuencia', hashValidacao: hash, status: 'DECLARADA_PENDENTE' });
    unmount();
    render(<VendedorPipeline leads={leads({ ...base, anuenciaStatus: 'CONFIRMADA' })} />);
    expect(screen.queryByRole('button', { name: 'Registrar anuência' })).toBeNull();
    expect((screen.getByRole('button', { name: /Incorporar cota ao pool/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Pix FALHOU: oferece reabrir (reabrir-pagamento-cedente), não pagar de novo', async () => {
    render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', pixStatus: 'FALHOU' })} />);
    expect(screen.queryByRole('button', { name: /Pagar cedente/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir pagamento' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'reabrir-pagamento-cedente', cessaoId: 'c1' });
  });

  it('Pix em andamento ou comprovado: sem "Reabrir"; comprovado sem botão de pagar', () => {
    const { unmount } = render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', pixStatus: 'INCERTO' })} />);
    expect(screen.queryByRole('button', { name: 'Reabrir pagamento' })).toBeNull();
    unmount();
    render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', pixStatus: 'COMPROVADA' })} />);
    expect(screen.queryByRole('button', { name: /Pagar cedente|Reconsultar|Reabrir/ })).toBeNull();
  });

  it('erro de domínio mostra só a mensagem fixa e o code; corpo sem code vira mensagem genérica', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Envio recusado: falta o laudo.', code: 'LAUDO_AUSENTE', detalhe: 'x' }), { status: 409 }),
    );
    render(<VendedorPipeline leads={leads({ laudoRegistrado: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /Enviar para assinatura/ }));
    expect(await screen.findByText('Envio recusado: falta o laudo. (LAUDO_AUSENTE)')).toBeTruthy();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stack interno' }), { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar para assinatura/ }));
    expect(await screen.findByText('Falha ao executar a ação (HTTP 500).')).toBeTruthy();
  });

  it('mostra o estado de cada etapa da cessão', () => {
    render(<VendedorPipeline leads={leads({ status: 'ENVIADA_DOCUSIGN', laudoRegistrado: true })} />);
    const lista = screen.getByRole('list', { name: 'Estado da cessão' });
    expect(lista.textContent).toContain('Assinatura: aguardando assinatura');
    expect(lista.textContent).toContain('Laudo: registrado');
    expect(lista.textContent).toContain('Anuência da administradora: não registrada');
  });

  it('textos da Consuelo: item 7 do laudo, atestado, dica da anuência, rótulo e Pix simulado na testnet', () => {
    const { unmount } = render(<VendedorPipeline leads={leads({ laudoRegistrado: false })} />);
    expect(screen.getByText(/item 7 \(quitação\): saldo devedor R\$ 0,00/)).toBeTruthy();
    unmount();
    const u2 = render(<VendedorPipeline leads={leads({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: null })} />);
    expect(screen.getByText(/titular indicado no laudo é o titular do CPF do cadastro do cedente \(na testnet/)).toBeTruthy();
    u2.unmount();
    const u3 = render(
      <VendedorPipeline
        leads={leads({ status: 'ASSINADA', laudoRegistrado: true, laudoHash: 'c'.repeat(64), anuenciaStatus: 'DECLARADA_PENDENTE', titularSituacao: 'TITULAR_UNICO' })}
      />,
    );
    expect(screen.getByRole('list', { name: 'Estado da cessão' }).textContent).toContain('declarada, pendente (simulada)');
    expect(screen.getByRole('button', { name: 'Pagar cedente (Pix simulado, rede de testes)' })).toBeTruthy();
    u3.unmount();
    render(
      <VendedorPipeline
        leads={leads({ status: 'ASSINADA', laudoRegistrado: true, laudoHash: 'c'.repeat(64), titularSituacao: 'TITULAR_UNICO' })}
      />,
    );
    expect(screen.getByText(/Na demonstração, usar “Declarada, pendente”/)).toBeTruthy();
  });

  it('anuência Confirmada exige a referência; na rede PUBLIC não oferece "Declarada, pendente" nem Pix simulado', async () => {
    const c = { status: 'ASSINADA', laudoRegistrado: true, laudoHash: 'd'.repeat(64), titularSituacao: 'TITULAR_UNICO' };
    const u = render(<VendedorPipeline leads={leads(c)} />);
    fireEvent.change(screen.getByRole('combobox', { name: /Anuência da administradora/ }), { target: { value: 'CONFIRMADA' } });
    const botao = screen.getByRole('button', { name: 'Registrar anuência' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Referência do documento da administradora/), { target: { value: 'PROTOCOLO-TESTE' } });
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(corpo()).toMatchObject({ action: 'registrar-anuencia', status: 'CONFIRMADA', referencia: 'PROTOCOLO-TESTE' });
    u.unmount();
    render(<VendedorPipeline redePublica leads={leads(c)} />);
    expect(screen.queryByRole('option', { name: /Declarada, pendente/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pagar cedente (Pix)' })).toBeTruthy();
  });
});
