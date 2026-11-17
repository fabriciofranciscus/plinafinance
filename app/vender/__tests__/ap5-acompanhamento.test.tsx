// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => 'tok' }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';
import { ETAPAS_VENDER } from '@/lib/vender/etapas';

// AP-5 (Íris, acompanhamento-cedente/SPEC.md): contexto real persistente acima do stepper, exemplos recolhidos,
// validade e ressalva antes do aceite, foco no título consultado. Só composição: nada de fetch, nada de texto novo.
const SUMMARY = 'Exemplo ilustrativo (simulação em rede de testes).';
const CONTEXTO = 'Sua proposta está disponível abaixo, válida até a data indicada. Para aceitar, use o botão Aceitar nesta página.';

const base: AcompanharData = {
  leadId: 'lead-1', cedenteNome: 'Cedente Teste', status: 'OFERTA_ENVIADA', etapaAtual: 3, contextoDescricao: CONTEXTO,
  ofertaId: 'of-1', oferta: { valorCarta: 150000, desagioPct: '20.0', valorLiquido: 120000, prazoRestanteMeses: 18, validade: '17/11/2026 12:00' },
  cessaoId: null, consentTx: null, cessaoTx: null, pixTx: null, temCota: false,
};
const semOferta: AcompanharData = { ...base, status: 'CONTATADO', contextoDescricao: 'Nossa mesa está conferindo a titularidade.', ofertaId: null, oferta: null };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const real = () => screen.getByTestId('contexto-real');
const stepper = () => document.querySelector('ol') as HTMLElement;
const passo = (nome: string) => screen.getByRole('button', { name: new RegExp(nome) });
const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('contexto real persistente', () => {
  it('fica ACIMA do stepper, com "Etapa atual", o título da etapa real e a descrição real', () => {
    render(<AcompanharView data={base} />);
    expect(antes(real(), stepper())).toBe(true);
    expect(within(real()).getByText('Etapa atual')).toBeTruthy();
    expect(within(real()).getByRole('heading', { level: 2 }).textContent).toBe(ETAPAS_VENDER[3]);
    expect(within(real()).getByText(CONTEXTO)).toBeTruthy();
  });

  it('na etapa real o painel não repete título nem descrição (um só h2 com o título real)', () => {
    render(<AcompanharView data={base} />);
    expect(screen.getAllByRole('heading', { level: 2, name: ETAPAS_VENDER[3] })).toHaveLength(1);
    expect(screen.getAllByText(CONTEXTO)).toHaveLength(1);
    expect(screen.queryByText('Pré-visualização')).toBeNull();
  });

  it('ao consultar outra etapa a descrição real NÃO some; aparece "Pré-visualização" com o título consultado', () => {
    render(<AcompanharView data={base} />);
    fireEvent.click(passo('Cessão digital'));
    expect(within(real()).getByText(CONTEXTO)).toBeTruthy();
    expect(screen.getByText('Pré-visualização')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([ETAPAS_VENDER[3], ETAPAS_VENDER[4]]);
    fireEvent.click(screen.getByRole('button', { name: /Avançar/ }));
    expect(within(real()).getByText(CONTEXTO)).toBeTruthy();
  });

  it('sem contextoDescricao não se inventa texto de estado', () => {
    render(<AcompanharView data={{ ...base, contextoDescricao: '' }} />);
    expect(within(real()).queryByText(/./, { selector: 'p:not([class*="uppercase"])' })).toBeNull();
  });

  it('aguardando assinatura: o texto atual da DocuSign vem primeiro no contexto real', () => {
    render(<AcompanharView data={{ ...base, status: 'OFERTA_ACEITA', etapaAtual: 4, aguardandoAssinatura: true, cessaoId: 'ces-1' }} />);
    expect(within(real()).getByText(/O termo de cessão foi enviado para a sua assinatura/)).toBeTruthy();
    expect(screen.getByTestId('aguardando-assinatura')).toBeTruthy();
  });
});

describe('proposta: sem oferta (exemplo recolhido)', () => {
  it('o estado real fica fora e o exemplo vive só num <details> fechado com o resumo aprovado', () => {
    render(<AcompanharView data={semOferta} />);
    expect(screen.getByRole('status').textContent).toBe('Ainda não há proposta para esta solicitação.');
    const d = document.querySelector('details') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    const resumo = d.querySelector('summary') as HTMLElement;
    expect(resumo.textContent).toBe(SUMMARY);
    expect(resumo.className).toContain('min-h-[44px]');
  });

  it('nenhum valor de exemplo nem botão de aceite fora do disclosure', () => {
    render(<AcompanharView data={semOferta} />);
    const d = document.querySelector('details') as HTMLDetailsElement;
    for (const valor of ['120.000', '97.800', '18,5']) {
      const els = screen.getAllByText(new RegExp(valor.replace('.', '\\.')));
      expect(els.every((el) => d.contains(el)), valor).toBe(true);
    }
    const botoes = screen.getAllByRole('button', { name: /Aceitar proposta/, hidden: true });
    expect(botoes.every((b) => d.contains(b) && (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('abrir o exemplo é local: sem fetch e sem mudar de etapa', () => {
    render(<AcompanharView data={semOferta} />);
    const d = document.querySelector('details') as HTMLDetailsElement;
    fireEvent.click(d.querySelector('summary') as HTMLElement);
    d.open = true;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(real()).getByRole('heading', { level: 2 }).textContent).toBe(ETAPAS_VENDER[3]);
  });
});

describe('proposta: oferta real', () => {
  it('ordem de leitura: valores → validade → ressalva → aceite (data e ressalva ANTES do botão)', () => {
    render(<AcompanharView data={base} />);
    const validade = screen.getByText('Validade da proposta');
    const ressalva = screen.getByText(/Deságio simulado a partir do prazo/);
    const aceitar = screen.getByRole('button', { name: /Aceitar proposta/ });
    expect(antes(validade, ressalva)).toBe(true);
    expect(antes(ressalva, aceitar)).toBe(true);
    // a ressalva aparece uma vez só
    expect(screen.getAllByText(/Deságio simulado a partir do prazo/)).toHaveLength(1);
  });
  it('sem exemplo ilustrativo e sem <details> quando a oferta é real', () => {
    render(<AcompanharView data={base} />);
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });
  it('oferta indisponível para aceite (status diferente de OFERTA_ENVIADA): valores e ressalva, sem botão', () => {
    render(<AcompanharView data={{ ...base, status: 'OFERTA_ACEITA' }} />);
    expect(screen.getByText('Validade da proposta')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Aceitar proposta/ })).toBeNull();
  });
  it('aceite: um único POST com busy; navegar e abrir/fechar nada disso faz requisição', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<AcompanharView data={base} />);
    fireEvent.click(passo('Cessão digital'));
    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Avançar/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(passo('Proposta de preço'));
    const botao = screen.getByRole('button', { name: /Aceitar proposta/ });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('Pix', () => {
  const pixAusente: AcompanharData = { ...base, status: 'CESSAO_ASSINADA', etapaAtual: 5, cessaoId: 'ces-1', pixTx: null };
  it('sem Pix: o exemplo inteiro (check decorativo e valores) vive no <details>; só o comprovante real fica fora', () => {
    render(<AcompanharView data={pixAusente} />);
    const d = document.querySelector('details') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')?.textContent).toBe(SUMMARY);
    expect(d.textContent).toContain('✓');
    expect(d.textContent).toMatch(/R\$\s120\.000,00/);
    // Só o painel consultado: o stepper também mostra ✓ nas etapas concluídas, e isso é progresso real.
    const fora = within(screen.getByTestId('painel-consultado')).getAllByText(/✓|R\$\s120\.000,00/).filter((el) => !d.contains(el));
    expect(fora).toEqual([]);
    const comprovante = screen.getByRole('link', { name: /Ver comprovante/ });
    expect(d.contains(comprovante)).toBe(false);
    expect(antes(d, comprovante)).toBe(true);
  });
  it('com Pix e sem incorporação: valor com aviso e estado de incorporação abertos, sem diagrama e sem disclosure', () => {
    render(<AcompanharView data={{ ...pixAusente, pixTx: { hashShort: 'abcd', url: 'https://x.test/tx' } }} />);
    expect(document.querySelector('details')).toBeNull();
    expect(screen.getByTestId('cota-nao-incorporada')).toBeTruthy();
    expect(screen.queryByTestId('diagrama-cota-pool-token')).toBeNull();
    expect(screen.getByText(/Simulação em rede de testes: nenhum dinheiro real foi enviado/)).toBeTruthy();
  });
  it('concluída (com cota): diagrama e condição de /pool como hoje; a última etapa só vira ✓ com a cota', () => {
    render(<AcompanharView data={{ ...pixAusente, etapaAtual: 6, pixTx: { hashShort: 'abcd', url: 'https://x.test/tx' }, temCota: true }} />);
    expect(screen.getByTestId('diagrama-cota-pool-token')).toBeTruthy();
    expect(screen.getByTestId('cota-incorporada')).toBeTruthy();
  });
});

describe('foco depois da navegação explícita', () => {
  it('Avançar/Voltar/passo levam o foco ao título consultado; voltar à etapa real foca o título real', () => {
    render(<AcompanharView data={base} />);
    fireEvent.click(screen.getByRole('button', { name: /Avançar/ }));
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe(ETAPAS_VENDER[4]);
    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(document.activeElement?.textContent).toBe(ETAPAS_VENDER[3]);
    expect(real().contains(document.activeElement)).toBe(true);
    fireEvent.click(passo('Análise da cota'));
    expect(document.activeElement?.textContent).toBe(ETAPAS_VENDER[2]);
  });
  it('na carga inicial o foco não é movido', () => {
    render(<AcompanharView data={base} />);
    expect(document.activeElement).toBe(document.body);
  });
});
