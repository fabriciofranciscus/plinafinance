// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoricoView, { type EstadoHistorico, type FiltroHistorico } from '@/components/me/HistoricoView';
import { HISTORICO_EXEMPLO } from '@/lib/me/exemplos';
import type { EventoHistorico } from '@/lib/me/tipos';

afterEach(cleanup);

const estado = (over: Partial<EstadoHistorico> = {}): EstadoHistorico => ({
  carregando: false, erro: false, itens: HISTORICO_EXEMPLO, temMais: false, carregandoMais: false, erroMais: false, ...over,
});
const montar = (e: EstadoHistorico, filtro: FiltroHistorico = 'tudo', fns: Partial<Record<'onFiltro' | 'onTentarDeNovo' | 'onCarregarMais', () => void>> = {}) =>
  render(<HistoricoView estado={e} filtro={filtro} onFiltro={fns.onFiltro ?? vi.fn()} onTentarDeNovo={fns.onTentarDeNovo ?? vi.fn()} onCarregarMais={fns.onCarregarMais ?? vi.fn()} />);

describe('/historico (spec de UX §3)', () => {
  it('lista os eventos mais recentes primeiro, com rótulo, valor, situação e transação', () => {
    montar(estado());
    const pilha = document.querySelector('ol')!;
    const itens = within(pilha).getAllByRole('listitem');
    expect(itens).toHaveLength(HISTORICO_EXEMPLO.length);
    expect(itens[0]!.textContent).toContain('Saída do pool');
    expect(itens[0]!.textContent).toContain('200,0000 PLINA-RF → R$');
    expect(itens[1]!.textContent).toContain('Entrada no pool');
    expect(itens[1]!.textContent).toMatch(/R\$\s500,00 → 500,0000 PLINA-RF/);
    expect(itens[0]!.textContent).toContain('Concluído');
  });

  it('transação: link para o explorer em nova aba, com hash curto e nome acessível; sem transação diz "Sem transação on-chain"', () => {
    montar(estado());
    const link = screen.getAllByRole('link', { name: /Transação 3f9a…c21e no explorer, abre em nova aba/ })[0]!;
    expect(link.getAttribute('href')).toBe(`https://stellar.expert/explorer/testnet/tx/${HISTORICO_EXEMPLO[0]!.txHash}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByText('Sem transação on-chain').length).toBeGreaterThan(0);
  });

  it('Pix leva "(simulado)"; evento da venda aponta para o acompanhamento', () => {
    montar(estado());
    expect(screen.getAllByText('Pagamento simulado enviado').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Pix enviado/)).toBeNull();
    expect(screen.getAllByText(/Concluído \(simulação na rede de testes\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Abrir acompanhamento →' })[0]!.getAttribute('href')).toBe('/vender/acompanhar/exemplo000000a1b2c3');
  });

  it('agrupa por mês e a tabela do desktop tem th scope="col" nas quatro colunas', () => {
    const outubro: EventoHistorico = { ...HISTORICO_EXEMPLO[4]!, id: 'o1', em: '2026-10-20T15:00:00Z' };
    montar(estado({ itens: [...HISTORICO_EXEMPLO, outubro] }));
    expect(document.querySelectorAll('section[aria-label]').length).toBe(2);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['novembro de 2026', 'outubro de 2026']);
    const th = [...document.querySelectorAll('th[scope="col"]')].map((t) => t.textContent);
    expect(th.slice(0, 4)).toEqual(['Data', 'Evento', 'Valor', 'Situação e transação']);
  });

  it('filtro só aparece quando a conta tem os dois lados; usa aria-pressed e chama onFiltro', () => {
    const onFiltro = vi.fn();
    montar(estado(), 'tudo', { onFiltro });
    const grupo = screen.getByRole('group', { name: 'Filtrar por lado' });
    expect(within(grupo).getByRole('button', { name: 'Tudo' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(grupo).getByRole('button', { name: 'Vender' }));
    expect(onFiltro).toHaveBeenCalledWith('vender');
    cleanup();
    montar(estado({ itens: HISTORICO_EXEMPLO.filter((e) => e.lado === 'investir') }));
    expect(screen.queryByRole('group', { name: 'Filtrar por lado' })).toBeNull();
  });

  it('com filtro, mostra só aquele lado; vazio com filtro oferece "Ver tudo"', () => {
    montar(estado(), 'investir');
    expect(screen.queryByText('Cota incorporada ao pool')).toBeNull();
    expect(screen.getAllByText('Entrada no pool').length).toBeGreaterThan(0);
    cleanup();
    const soInvestir: EventoHistorico[] = HISTORICO_EXEMPLO.filter((e) => e.lado === 'investir');
    const onFiltro = vi.fn();
    montar(estado({ itens: soInvestir }), 'vender', { onFiltro });
    expect(screen.getByText('Nenhum evento de Vender nesta conta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver tudo' }));
    expect(onFiltro).toHaveBeenCalledWith('tudo');
  });

  it('vazio: texto da spec e links para Investir e Vender', () => {
    montar(estado({ itens: [] }));
    expect(screen.getByText(/Ainda não há eventos nesta conta\. Quando você investir, sacar ou enviar uma cota/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Investir (testnet) →' }).getAttribute('href')).toBe('/investir');
    expect(screen.getByRole('link', { name: 'Vender uma cota →' }).getAttribute('href')).toBe('/vender');
  });

  it('carregando e erro: role=status e role=alert com "Tentar de novo"', () => {
    montar(estado({ carregando: true, itens: [] }));
    expect(screen.getByRole('status').textContent).toBe('Carregando seu histórico…');
    cleanup();
    const retry = vi.fn();
    montar(estado({ erro: true, itens: [] }), 'tudo', { onTentarDeNovo: retry });
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar seu histórico agora.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(retry).toHaveBeenCalled();
  });

  it('carregar mais: botão com temMais; erro ao carregar mais mantém a lista e troca o botão', () => {
    const mais = vi.fn();
    montar(estado({ temMais: true }), 'tudo', { onCarregarMais: mais });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(mais).toHaveBeenCalled();
    cleanup();
    montar(estado({ temMais: true, erroMais: true }));
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar mais eventos agora.');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
    expect(document.querySelectorAll('ol li').length).toBe(HISTORICO_EXEMPLO.length);
  });

  it('falha: só "O pagamento não foi concluído." (sem prometer que nada foi cobrado, nem repetir texto do servidor); sem termos proibidos', () => {
    const falhou: EventoHistorico = { ...HISTORICO_EXEMPLO[0]!, id: 'f1', situacao: 'falhou', motivo: 'O Pix não foi concluído. Nada foi cobrado.', txHash: null };
    montar(estado({ itens: [falhou] }));
    expect(screen.getAllByText('O pagamento não foi concluído.').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Nada foi cobrado|cobrad/i);
    expect(screen.getAllByText(/Falhou/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/rendimento|retorno|yield|oferta firme/i);
  });

  it('Consuelo item 11: cessão simulada leva "(demonstração)"; real não; nenhum rótulo "Pix enviado" nem "jurídica"', () => {
    const cessao: EventoHistorico = { ...HISTORICO_EXEMPLO[2]!, id: 'c1', tipo: 'cessao_assinada', simulado: true };
    montar(estado({ itens: [cessao] }));
    expect(screen.getAllByText('Cessão assinada (demonstração)').length).toBeGreaterThan(0);
    cleanup();
    montar(estado({ itens: [{ ...cessao, simulado: false }] }));
    expect(screen.getAllByText('Cessão assinada').length).toBeGreaterThan(0);
    // evento real: "Concluído" sem o qualificador de rede de testes
    expect(document.body.textContent).toMatch(/Concluído · /);
    expect(document.body.textContent).not.toContain('simulação na rede de testes');
    expect(document.body.textContent).not.toMatch(/Pix enviado|jurídica/i);
  });
});
