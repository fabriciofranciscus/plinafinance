// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ executarClawbackAction: vi.fn() }));

import { InvestidoresPainel, type InvestidorAdmin } from '../investidores-painel';
import { PaineisAdmin } from '../paineis';
import { Concentracao } from '../concentracao';

// Design system v1.2, fatia V1 (admin: shell, painéis, Investidores, ClawbackForm, concentração).
// Só apresentação: os handlers, textos, ids e estados dos testes anteriores continuam valendo.
const src = (f: string) => readFileSync(`app/admin/${f}`, 'utf8');
const ARQUIVOS_V1 = ['page.tsx', 'paineis.tsx', 'investidores-painel.tsx', 'clawback-form.tsx', 'concentracao.tsx'];

const lista: InvestidorAdmin[] = [
  { id: 'inv-a', email: 'a@exemplo.test', publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ', explorerUrl: 'https://explorer.test/a', saldoEsperado: '139,6', status: 'AUTORIZADO' },
  { id: 'inv-b', email: 'b@exemplo.test', publicKey: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWXYZ', explorerUrl: 'https://explorer.test/b', saldoEsperado: '0', status: 'PENDENTE' },
];

afterEach(cleanup);

describe('o estilo da v1.1 saiu dos arquivos desta fatia', () => {
  it.each(ARQUIVOS_V1)('%s: sem label 10 px com uppercase/tracking largo, sem transition-all, sem sombra ciano', (f) => {
    const s = src(f);
    expect(s, f).not.toMatch(/tracking-\[0\.(15|2|3)em\]/);
    expect(s, f).not.toMatch(/\buppercase\b/);
    expect(s, f).not.toMatch(/text-\[10px\]/);
    expect(s, f).not.toMatch(/transition-all/);
    // `divide-light-hairline` não aplica cor (o utilitário só existe como border-*): saía preto. O hairline é petróleo a 12%.
    expect(s, f).not.toMatch(/divide-light-hairline/);
    expect(s, f).not.toMatch(/rgba\(14,\s*167,\s*199/);
  });
});

describe('shell e hierarquia (page.tsx)', () => {
  const page = src('page.tsx');
  it('container operacional de 1440 px com gutter fluido, marcado como produto (reduced motion)', () => {
    expect(page).toContain('max-w-[var(--workspace-max)]');
    expect(page).toContain('px-[var(--spacing-gutter-ui)]');
    expect(page).toContain('plina-product');
    expect(page).not.toMatch(/max-w-6xl/);
  });
  it('um h1 com o papel de título da página e h2 com o papel de seção (sem text-2xl ad hoc)', () => {
    expect(page.match(/<h1/g)).toHaveLength(1);
    expect(page).toMatch(/<h1 className="[^"]*text-page-title/);
    expect(page).not.toMatch(/<h2 className="[^"]*text-2xl/);
    expect(page).toMatch(/<h2 className="[^"]*text-section-title/);
  });
  it('tabelas com moldura externa de 16 px e células retas; indicadores em mono; valores decisivos em mono', () => {
    expect(page).toMatch(/rounded-panel border border-light-hairline overflow-x-auto/);
    expect(page).toMatch(/<p className="[^"]*font-mono[^"]*text-value-primary/);
  });
  it('rótulos como label funcional (14 px / 500), em tinta secundária ≥ 70%', () => {
    expect(page).toContain('text-label-ui');
    expect(page).not.toMatch(/text-base\/(50|55|60)\b/);
  });
});

describe('navegação de seções (paineis.tsx)', () => {
  const paineis = [
    { id: 'vendedores' as const, rotulo: 'Solicitações (1)', conteudo: <h2>Solicitações</h2> },
    { id: 'investidores' as const, rotulo: 'Investidores (2)', conteudo: <h2>Investidores</h2> },
  ];
  it('o gutter da barra acompanha o gutter da página e o link ativo continua com aria-current e identificação além da cor', () => {
    const s = src('paineis.tsx');
    expect(s).toContain('-mx-[var(--spacing-gutter-ui)]');
    expect(s).toContain('px-[var(--spacing-gutter-ui)]');
    window.location.hash = '#investidores';
    render(<PaineisAdmin paineis={paineis} />);
    const ativo = within(screen.getByRole('navigation', { name: 'Seções do painel' })).getByRole('link', { name: 'Investidores (2)' });
    expect(ativo.getAttribute('aria-current')).toBe('true');
    expect(ativo.className).toMatch(/border-b-2/);
    expect(ativo.className).toContain('text-label-ui');
  });
});

describe('Investidores: lista + detalhe (investidores-painel.tsx)', () => {
  it('o detalhe do investidor selecionado é o bloco de destaque: painel de 16 px com sombra "raised"; os demais não têm sombra', () => {
    const s = src('investidores-painel.tsx');
    expect(s).toMatch(/data-detalhe=\{inv\.id\}[^>]*className="[^"]*rounded-panel[^"]*shadow-raised/);
    expect((s.match(/shadow-raised/g) ?? []).length).toBe(1);
    expect(s).not.toMatch(/shadow-overlay/);
  });
  it('lista do celular em moldura de 16 px (células retas) e a tabela do desktop não vira cartões', () => {
    const s = src('investidores-painel.tsx');
    expect(s).toMatch(/data-testid="lista-mobile" className="[^"]*rounded-panel/);
    expect(s).toMatch(/data-testid="lista-tabela" className="[^"]*\btable-fixed\b/);
  });
  it('o status do investidor continua visível, como texto (identificador em mono), na lista e no detalhe', () => {
    render(<InvestidoresPainel investidores={lista} />);
    expect(screen.getAllByText('AUTORIZADO').length).toBeGreaterThanOrEqual(2);
    for (const el of screen.getAllByText('AUTORIZADO')) expect(el.className).toContain('font-mono');
  });
  it('o formulário de clawback do detalhe tem 1 coluna (campos legíveis na coluna de 5/12) e não é um cartão dentro do cartão', () => {
    const c = src('clawback-form.tsx');
    expect(c).not.toMatch(/md:grid-cols-3/);
    expect(c).toMatch(/grid grid-cols-1 gap-4/);
    expect(c).not.toMatch(/<form[^>]*border border-light-hairline/);
    expect(c).not.toMatch(/<form[^>]*bg-lightBg\/40/);
  });
  it('campos do clawback: 16 px e alvo mínimo de 44 px', () => {
    const c = src('clawback-form.tsx');
    expect(c).toMatch(/inputClass =\s*'[^']*min-h-\[44px\][^']*text-base/);
    expect(c).toMatch(/rounded-full|rounded-\[/);
  });
});

describe('concentração (concentracao.tsx)', () => {
  it('moldura de 16 px, rótulo funcional e estado "concentrado"/"ok" com texto (não só cor), em mono', () => {
    const { container } = render(<Concentracao itens={[{ administradora: 'Adm A', valor: 'R$ 100.000', participacao: '55%', alerta: true }, { administradora: 'Adm B', valor: 'R$ 80.000', participacao: '45%', alerta: false }]} />);
    expect(container.firstElementChild!.className).toContain('rounded-panel');
    expect(screen.getByText('concentrado').className).toContain('font-mono');
    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.getByText(/Concentração por administradora/).className).toContain('text-label-ui');
  });
});
