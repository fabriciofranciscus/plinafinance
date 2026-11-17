// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const getJson = vi.fn();
vi.mock('@/lib/http/client', () => ({ getJson: (...a: unknown[]) => getJson(...a), postJson: vi.fn() }));

import { BuscarScreen } from '../_components/screens/buscar';
import { DiligenciaScreen } from '../_components/screens/diligencia';
import { PropostaScreen } from '../_components/screens/proposta';
import { KycScreen } from '../_components/screens/kyc';
import { CessaoScreen } from '../_components/screens/cessao';
import { ConfirmacaoScreen } from '../_components/screens/confirmacao';
import { useCotas } from '../_hooks/use-cotas';
import type { CessaoData, CotaResumo, ReservaData } from '../_types';

// AP-5 /comprar, PR 2 (Íris, comprar-composicao/SPEC.md C3, C4, C12): a lista tem 4 saídas exclusivas, o erro fica junto da
// ação que o gerou e cada "Selecionar cota" tem nome distinto. Só composição: nenhuma requisição nova.
const FILTRO_VAZIO = 'Nenhuma cota disponível com esses filtros. Ajuste e tente de novo.';
const cota = (id: string, tipoBem: string, valorCarta: number, loc: string | null): CotaResumo => ({ id, tipoBem, valorCarta, desagioRevenda: 0.2, localizacaoAprox: loc, prazoRestanteMeses: 0, statusEstoque: 'DISPONIVEL' });
const cotas = [cota('c1', 'IMOVEL', 200000, 'Campinas, SP'), cota('c2', 'VEICULO', 80000, null)];
const reserva = { reservaId: 'res-1234567890abcdef', expiraEm: '2026-11-20T15:30:00.000Z', txHash: 'aaaaaaaabbbbbbbb' } as ReservaData;
const cessao = { cessaoCompradorId: 'ces-1234567890abcdef', hashDocumento: 'ddddddddddeeeeeeee', txHash: 'ffffffffgggggggg' } as CessaoData;
const pessoa = { nome: 'Comprador Teste', email: 'c@exemplo.test' } as never;
const ERRO = <div data-testid="erro-da-acao" role="alert">Operação interrompida</div>;

beforeEach(() => getJson.mockReset());
afterEach(cleanup);

describe('Buscar: quatro saídas exclusivas (C3)', () => {
  const filtroVazio = () => screen.queryByText(FILTRO_VAZIO);
  it('carregando (inclusive antes do primeiro load, cotas null): "Carregando cotas…" com role=status; nunca a frase de filtro', () => {
    const { rerender } = render(<BuscarScreen cotas={null} loading falhou={false} onSelect={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe('Carregando cotas…');
    expect(filtroVazio()).toBeNull();
    rerender(<BuscarScreen cotas={null} loading={false} falhou={false} onSelect={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe('Carregando cotas…');
    expect(filtroVazio()).toBeNull();
  });

  it('falha: o erro ocupa o lugar da lista; a frase de filtro vazio NÃO aparece; os filtros ficam', () => {
    render(<BuscarScreen cotas={null} loading={false} falhou erro={ERRO} onSelect={() => {}} />);
    expect(screen.getByTestId('erro-da-acao')).toBeTruthy();
    expect(filtroVazio()).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Tipo de bem')).toBeTruthy();
    expect(screen.getByLabelText('Desconto mínimo')).toBeTruthy();
  });

  it('falha com o erro dispensado: continua sem a frase de filtro vazio (não vira "vazio")', () => {
    render(<BuscarScreen cotas={null} loading={false} falhou onSelect={() => {}} />);
    expect(filtroVazio()).toBeNull();
  });

  it('lista carregada e filtrada a zero: a frase atual de filtro vazio', () => {
    render(<BuscarScreen cotas={[]} loading={false} falhou={false} onSelect={() => {}} />);
    expect(filtroVazio()).toBeTruthy();
  });

  it('com itens: ul/li, um li por cota', () => {
    render(<BuscarScreen cotas={cotas} loading={false} falhou={false} onSelect={() => {}} />);
    const ul = screen.getByRole('list');
    expect(within(ul).getAllByRole('listitem')).toHaveLength(2);
    expect(filtroVazio()).toBeNull();
  });
});

describe('Selecionar cota com nome distinto (C12)', () => {
  it('cada botão aponta (aria-describedby) para o tipo/local e o valor de face do PRÓPRIO cartão; o nome acessível não muda', () => {
    render(<BuscarScreen cotas={cotas} loading={false} falhou={false} onSelect={() => {}} />);
    const botoes = screen.getAllByRole('button', { name: 'Selecionar cota →' });
    expect(botoes).toHaveLength(2);
    const descricao = (b: HTMLElement) => (b.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' | ');
    expect(descricao(botoes[0]!)).toMatch(/Imóvel · Campinas, SP \| R\$\s200\.000/);
    expect(descricao(botoes[1]!)).toMatch(/Veículo \| R\$\s80\.000/);
    expect(descricao(botoes[0]!)).not.toContain('Veículo');
    const ids = botoes.flatMap((b) => (b.getAttribute('aria-describedby') ?? '').split(' '));
    expect(new Set(ids).size).toBe(ids.length); // ids únicos entre cartões
  });
});

describe('useCotas distingue falha de lista vazia (C3)', () => {
  const args = () => ({ getAccessToken: async () => 't', onError: vi.fn(), clearError: vi.fn() });
  it('falhou=false até carregar; true quando a leitura falha; volta a false ao recarregar com sucesso', async () => {
    getJson.mockRejectedValueOnce(new Error('boom'));
    const a = args();
    const { result } = renderHook(() => useCotas(a));
    expect(result.current.falhou).toBe(false);
    await act(async () => { await result.current.load(); });
    expect(result.current.falhou).toBe(true);
    expect(result.current.cotas).toBeNull();
    expect(a.onError).toHaveBeenCalledTimes(1);
    getJson.mockResolvedValueOnce({ cotas: [] });
    await act(async () => { await result.current.load(); });
    await waitFor(() => expect(result.current.falhou).toBe(false));
    expect(result.current.cotas).toEqual([]);
  });
});

describe('o erro fica imediatamente abaixo da ação que o gerou (C4)', () => {
  const colado = (nome: RegExp) => expect(screen.getByRole('button', { name: nome }).nextElementSibling).toBe(screen.getByTestId('erro-da-acao'));
  it('diligência', () => {
    render(<DiligenciaScreen selectedCota={cotas[0]!} data={null} loading={false} onContinue={() => {}} erro={ERRO} />);
    colado(/Avançar para proposta/);
  });
  it('proposta', () => {
    render(<PropostaScreen cota={cotas[0]!} loading={false} onAceitar={() => {}} erro={ERRO} />);
    colado(/Aceitar proposta e reservar/);
  });
  it('identidade', () => {
    render(<KycScreen pessoa={pessoa} cota={cotas[0]!} reserva={reserva} loading={false} onSubmit={() => {}} erro={ERRO} />);
    colado(/Verificar identidade/);
  });
  it('cessão', () => {
    render(<CessaoScreen pessoa={pessoa} cota={cotas[0]!} reserva={reserva} cessao={null} signing={false} onAssinar={() => {}} erro={ERRO} />);
    colado(/Simular assinatura/);
  });
  it('confirmação inicial', () => {
    render(<ConfirmacaoScreen cota={cotas[0]!} reserva={reserva} cessao={cessao} confirmacao={null} confirming={false} onConfirmar={() => {}} erro={ERRO} />);
    colado(/Confirmar transferência/);
  });
  it('sem erro nada é renderizado no lugar', () => {
    render(<PropostaScreen cota={cotas[0]!} loading={false} onAceitar={() => {}} />);
    expect(screen.queryByTestId('erro-da-acao')).toBeNull();
  });
});
