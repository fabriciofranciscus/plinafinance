// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaineisAdmin } from '../paineis';
import { PAINEIS_ORDEM, type IdPainel } from '@/lib/admin/paineis';

const ROTULOS: Record<IdPainel, string> = {
  vendedores: 'Solicitações (3)', compradores: 'Compradores (2)', cotas: 'Cotas (4)', investidores: 'Investidores (5)',
  overview: 'Overview', audit: 'Audit log', incorporar: 'Avulsas',
};
const paineis = PAINEIS_ORDEM.map((id) => ({
  id,
  rotulo: ROTULOS[id],
  conteudo:
    id === 'incorporar' ? (
      // Avulsas: o título do painel é o <summary> do <details>, não um h2 (como na página real).
      <details id={id}>
        <summary>Operações avulsas</summary>
        <input aria-label={`campo ${id}`} defaultValue="" />
        <button type="button">{`ação ${id}`}</button>
      </details>
    ) : (
      <section id={id}>
        <h2>{`Título ${id}`}</h2>
        <input aria-label={`campo ${id}`} defaultValue="" />
        <button type="button">{`ação ${id}`}</button>
      </section>
    ),
}));
const montar = () => render(<PaineisAdmin paineis={paineis} />);
const visivel = () => PAINEIS_ORDEM.filter((id) => !document.querySelector(`[data-painel="${id}"]`)!.hasAttribute('hidden'));

beforeEach(() => window.history.replaceState(null, '', '/admin'));
afterEach(cleanup);

describe('AP-3: um painel por vez', () => {
  it('entrada padrão: só Solicitações; o resto fica fora da árvore acessível (botões ocultos não aparecem)', () => {
    montar();
    expect(visivel()).toEqual(['vendedores']);
    expect(screen.getAllByRole('button', { name: /^ação / }).map((b) => b.textContent)).toEqual(['ação vendedores']);
  });

  it('navegação: links com os nomes atuais, na ordem da spec, painel ativo com aria-current', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: 'Seções do painel' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(PAINEIS_ORDEM.map((id) => ROTULOS[id]));
    expect(links.map((l) => l.getAttribute('href'))).toEqual(PAINEIS_ORDEM.map((id) => `#${id}`));
    expect(links[0]!.getAttribute('aria-current')).toBe('true');
    expect(links[1]!.getAttribute('aria-current')).toBeNull();
  });

  it('clicar num destino troca o painel e leva o foco ao título do painel', async () => {
    montar();
    const nav = screen.getByRole('navigation', { name: 'Seções do painel' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Compradores (2)' }));
    window.location.hash = '#compradores'; // o navegador faz isso no clique; o jsdom não segue o href
    await waitFor(() => expect(visivel()).toEqual(['compradores']));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Título compradores'));
    expect(within(nav).getByRole('link', { name: 'Compradores (2)' }).getAttribute('aria-current')).toBe('true');
  });

  it('Avulsas (sem h2): o foco vai para o <summary> do painel, não se perde no body (Vera)', async () => {
    montar();
    window.location.hash = '#incorporar';
    await waitFor(() => expect(visivel()).toEqual(['incorporar']));
    await waitFor(() => expect(document.activeElement?.tagName).toBe('SUMMARY'));
    expect(document.activeElement?.textContent).toBe('Operações avulsas');
  });

  it('seletor do celular: rótulo "Seção", sete opções, valor atual e troca de painel', async () => {
    montar();
    const sel = screen.getByLabelText('Seção') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(PAINEIS_ORDEM.map((id) => ROTULOS[id]));
    expect(sel.value).toBe('vendedores');
    fireEvent.change(sel, { target: { value: 'cotas' } });
    await waitFor(() => expect(visivel()).toEqual(['cotas']));
    expect((screen.getByLabelText('Seção') as HTMLSelectElement).value).toBe('cotas');
  });
});

describe('AP-3: âncoras legadas e estado', () => {
  it.each([
    ['#overview', 'overview'], ['#vendedores', 'vendedores'], ['#compradores', 'compradores'], ['#cotas', 'cotas'],
    ['#investidores', 'investidores'], ['#audit', 'audit'], ['#incorporar', 'incorporar'],
  ])('abrir /admin%s abre o painel %s', async (hash, id) => {
    window.history.replaceState(null, '', `/admin${hash}`);
    montar();
    await waitFor(() => expect(visivel()).toEqual([id]));
  });

  it('#lead-<id> abre Solicitações; hash desconhecido também, sem foco nem erro', async () => {
    window.history.replaceState(null, '', '/admin#lead-cmlead0000a1b2c3');
    montar();
    await waitFor(() => expect(visivel()).toEqual(['vendedores']));
    cleanup();
    window.history.replaceState(null, '', '/admin#nao-existe');
    montar();
    expect(visivel()).toEqual(['vendedores']);
  });

  it('o que foi digitado num painel continua lá depois de trocar e voltar (painéis ficam montados)', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('campo vendedores'), { target: { value: 'rascunho' } });
    window.location.hash = '#cotas';
    await waitFor(() => expect(visivel()).toEqual(['cotas']));
    window.location.hash = '#vendedores';
    await waitFor(() => expect(visivel()).toEqual(['vendedores']));
    expect((screen.getByLabelText('campo vendedores') as HTMLInputElement).value).toBe('rascunho');
  });

  it('nada é gravado na URL além do destino: sem nome, e-mail ou busca', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Seção'), { target: { value: 'investidores' } });
    await waitFor(() => expect(window.location.hash).toBe('#investidores'));
    expect(window.location.search).toBe('');
  });
});

describe('AP-3: a página do admin usa os painéis', () => {
  const src = readFileSync('app/admin/page.tsx', 'utf8');
  it('monta <PaineisAdmin> e não tem mais a faixa de âncoras antiga', () => {
    expect(src).toContain('<PaineisAdmin');
    expect(src).not.toMatch(/<nav className="sticky top-14/);
  });
  it('o clawback de cada investidor nasce fechado, num <details> com summary de 44 px (o formulário agora vive em investidores-painel.tsx)', () => {
    const src = readFileSync('app/admin/investidores-painel.tsx', 'utf8');
    const i = src.indexOf('<ClawbackForm');
    expect(i).toBeGreaterThan(-1);
    const antes = src.slice(Math.max(0, i - 600), i);
    expect(antes).toMatch(/<details[^>]*>\s*<summary[^>]*min-h-\[44px\][^>]*>\s*Clawback\s*<\/summary>/);
    expect(antes).not.toMatch(/<details[^>]*\bopen\b/);
  });
  it('Resumo: oito métricas em dois grupos de quatro (sem célula vazia)', () => {
    // v1.2: a grade ganhou a moldura de 16 px (rounded-panel), então a classe termina diferente; a regra é a mesma: 4 colunas.
    expect(src).not.toMatch(/md:grid-cols-3 gap-px bg-base\/15 [^"]*">\s*<Metric label="NAV \/ token"/);
    expect(src).toMatch(/md:grid-cols-4 gap-px bg-base\/15 [^"]*">\s*<Metric label="NAV \/ token"/);
  });
});
