// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const executar = vi.fn();
vi.mock('../actions', () => ({ executarClawbackAction: (...a: unknown[]) => executar(...a) }));

import { InvestidoresPainel, type InvestidorAdmin } from '../investidores-painel';

// U1-11 PR 2 (spec da Íris, admin-clawback/SPEC.md §2): lista + detalhe; um alvo por vez; o ClawbackForm ATUAL dentro do detalhe.
const lista: InvestidorAdmin[] = [
  { id: 'inv-a', email: 'a@exemplo.test', publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ', explorerUrl: 'https://explorer.test/a', saldoEsperado: '139,6', status: 'AUTORIZADO' },
  { id: 'inv-b', email: 'b@exemplo.test', publicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWXYZ', explorerUrl: 'https://explorer.test/b', saldoEsperado: '0', status: 'PENDENTE' },
  { id: 'inv-c', email: 'c@exemplo.test', publicKey: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWXYZ', explorerUrl: 'https://explorer.test/c', saldoEsperado: '12', status: 'AUTORIZADO' },
];
const montar = () => render(<InvestidoresPainel investidores={lista} />);
const detalhe = (id: string) => document.querySelector(`[data-detalhe="${id}"]`) as HTMLElement;
const visiveis = () => lista.filter((i) => !detalhe(i.id).hasAttribute('hidden')).map((i) => i.id);
const linkDaTabela = (email: string) => within(screen.getByTestId('lista-tabela')).getByRole('link', { name: email });

afterEach(() => {
  cleanup();
  executar.mockReset();
});

describe('lista', () => {
  it('tabela semântica com os rótulos de hoje (Email, Public key, Saldo esperado) e a lista do celular', () => {
    montar();
    const t = within(screen.getByTestId('lista-tabela'));
    expect(t.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Email', 'Public key', 'Saldo esperado']);
    expect(t.getAllByRole('row').slice(1)).toHaveLength(3);
    expect(within(screen.getByTestId('lista-mobile')).getAllByRole('button')).toHaveLength(3);
  });
  it('chave abreviada na lista (a chave inteira fica no detalhe)', () => {
    montar();
    expect(within(screen.getByTestId('lista-tabela')).getAllByText(/^GAAAA…WXYZ$/).length).toBeGreaterThan(0);
  });
  it('sem seleção: "Escolha um investidor na lista." e nenhum detalhe nem formulário visível', () => {
    montar();
    expect(screen.getByText('Escolha um investidor na lista.')).toBeTruthy();
    expect(visiveis()).toEqual([]);
  });
});

describe('seleção: um alvo por vez', () => {
  it('clicar no investidor abre só o detalhe dele, marca aria-current e leva o foco ao título', () => {
    montar();
    fireEvent.click(linkDaTabela('b@exemplo.test'));
    expect(visiveis()).toEqual(['inv-b']);
    expect(linkDaTabela('b@exemplo.test').getAttribute('aria-current')).toBe('true');
    expect(linkDaTabela('a@exemplo.test').getAttribute('aria-current')).toBeNull();
    expect(document.activeElement?.tagName).toBe('H3');
    expect(document.activeElement?.textContent).toBe('b@exemplo.test');
    expect(screen.queryByText('Escolha um investidor na lista.')).toBeNull();
  });
  it('a lista do celular também seleciona', () => {
    montar();
    fireEvent.click(within(screen.getByTestId('lista-mobile')).getAllByRole('button')[2]!);
    expect(visiveis()).toEqual(['inv-c']);
  });
  it('trocar de investidor troca o detalhe; selecionar nunca chama a action', () => {
    montar();
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    fireEvent.click(linkDaTabela('c@exemplo.test'));
    expect(visiveis()).toEqual(['inv-c']);
    expect(executar).not.toHaveBeenCalled();
  });
  it('"← Investidores" volta à lista e devolve o foco ao item de origem', () => {
    montar();
    fireEvent.click(linkDaTabela('b@exemplo.test'));
    fireEvent.click(within(detalhe('inv-b')).getByRole('button', { name: '← Investidores' }));
    expect(visiveis()).toEqual([]);
    expect(document.activeElement?.getAttribute('data-item')).toBe('inv-b');
  });
});

describe('detalhe e clawback', () => {
  it('detalhe com e-mail, chave inteira (link do explorer), saldo esperado e situação', () => {
    montar();
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    const dl = within(detalhe('inv-a').querySelector('dl') as HTMLElement);
    expect(dl.getByText(lista[0]!.publicKey).closest('a')?.getAttribute('href')).toBe('https://explorer.test/a');
    expect(dl.getByText('139,6')).toBeTruthy();
    expect(dl.getByText('AUTORIZADO')).toBeTruthy();
  });
  it('o clawback nasce FECHADO mesmo com o investidor selecionado; só abre pelo summary', () => {
    montar();
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    const det = detalhe('inv-a').querySelector('details') as HTMLDetailsElement;
    expect(det.open).toBe(false);
    expect(within(det).getByText('Clawback').closest('summary')).toBeTruthy();
  });
  it('cada formulário carrega o seu investidor (campo oculto) e os outros ficam ocultos', () => {
    montar();
    for (const i of lista) expect((detalhe(i.id).querySelector('input[name="investidorId"]') as HTMLInputElement).value).toBe(i.id);
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    expect(detalhe('inv-b').hasAttribute('hidden')).toBe(true);
  });
  it('o que foi digitado no clawback de um investidor continua lá depois de trocar de alvo e voltar (formulários seguem montados)', () => {
    montar();
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    (detalhe('inv-a').querySelector('details') as HTMLDetailsElement).open = true;
    const campo = detalhe('inv-a').querySelector('input[name="amount"]') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '10' } });
    fireEvent.click(linkDaTabela('b@exemplo.test'));
    fireEvent.click(linkDaTabela('a@exemplo.test'));
    expect((detalhe('inv-a').querySelector('input[name="amount"]') as HTMLInputElement).value).toBe('10');
    // e o rascunho de A não vai para B
    expect((detalhe('inv-b').querySelector('input[name="amount"]') as HTMLInputElement).value).toBe('');
  });
});

describe('a página usa o painel', () => {
  const src = readFileSync('app/admin/page.tsx', 'utf8');
  it('monta <InvestidoresPainel> e não instancia o ClawbackForm direto', () => {
    expect(src).toContain('<InvestidoresPainel');
    expect(src).not.toContain('<ClawbackForm');
  });
});
