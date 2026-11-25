// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ executarClawbackAction: vi.fn() }));

import { InvestidoresPainel, type InvestidorAdmin } from '../investidores-painel';
import { PaineisAdmin } from '../paineis';
import { Concentracao } from '../concentracao';
import { AppFooter } from '@/components/AppFooter';

// Design system v1.2, fatia V1 (admin: shell, painéis, Investidores, ClawbackForm, concentração).
// Só apresentação: os handlers, textos, ids e estados dos testes anteriores continuam valendo.
const src = (f: string) => readFileSync(`app/admin/${f}`, 'utf8');
const ARQUIVOS_V1 = ['page.tsx', 'paineis.tsx', 'revisao-acao.tsx', 'investidores-painel.tsx', 'clawback-form.tsx', 'concentracao.tsx', 'loading.tsx', 'error.tsx'];

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

// Revisão visual da Íris (12:34): 3 ajustes antes do PR.
describe('ajustes da revisão visual (Íris)', () => {
  it('1. o seletor "Seção" do celular é pill, com o mesmo contorno dos campos (não só o hairline)', () => {
    const s = src('paineis.tsx');
    const select = s.match(/<select[\s\S]*?className="([^"]*)"/)![1]!;
    expect(select).toContain('rounded-full');
    expect(select).toContain('border-base/40');
    expect(select).not.toContain('border-light-hairline');
  });

  it('2. carregando e erro usam o mesmo container da página carregada (1440 + gutter fluido), sem salto de largura', () => {
    for (const f of ['loading.tsx', 'error.tsx']) {
      const c = src(f);
      expect(c, f).toContain('max-w-[var(--workspace-max)]');
      expect(c, f).toContain('px-[var(--spacing-gutter-ui)]');
      expect(c, f).not.toContain('max-w-6xl');
    }
    expect(src('loading.tsx')).toMatch(/<h1 className="[^"]*text-page-title/);
  });

  it('3. no /admin, cabeçalho e rodapé globais usam o container operacional (mesma borda esquerda do painel)', () => {
    const shell = readFileSync('components/AppShell.tsx', 'utf8');
    expect(shell).toMatch(/operacional/);
    expect(shell).toMatch(/<AppHeader[^>]*operacional=\{operacional\}/);
    expect(shell).toMatch(/<AppFooter[^>]*operacional=\{operacional\}/);
    expect(shell).toMatch(/pathname === '\/admin' \|\| pathname\.startsWith\('\/admin\/'\)/);
    const header = readFileSync('components/AppHeader.tsx', 'utf8');
    expect(header).toContain('operacional');
    expect(header).toContain('max-w-[var(--workspace-max)] px-[var(--spacing-gutter-ui)]');
  });

  it('3b. o rodapé operacional alinha com o painel; o padrão continua em 1152 px', () => {
    const { container, unmount } = render(<AppFooter issuerPubkey="GCN34WOPABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMWLGA7E" operacional />);
    const cont = [...container.querySelectorAll('footer > div > div, footer > div')].map((e) => e.className).join(' ');
    expect(cont).toContain('max-w-[var(--workspace-max)]');
    expect(cont).not.toContain('max-w-6xl');
    unmount();
    const padrao = render(<AppFooter issuerPubkey="GCN34WOPABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMWLGA7E" />);
    expect(padrao.container.innerHTML).toContain('max-w-6xl');
    expect(padrao.container.innerHTML).not.toContain('--workspace-max');
  });
});

describe('observações da Íris adiantadas', () => {
  it('concentração com largura limitada (rótulo e valor juntos); cabeçalho da tabela de investidores com divisor', () => {
    expect(src('concentracao.tsx')).toContain('max-w-4xl');
    expect(src('investidores-painel.tsx')).toMatch(/<tr className="text-left border-b border-base\/12">/);
  });
  it('o summary "Clawback" tem indicador + / − decorativo (aria-hidden) e o nome acessível não mudou', () => {
    const { container } = render(<InvestidoresPainel investidores={lista} />);
    const resumo = container.querySelector('details > summary') as HTMLElement;
    expect(resumo.querySelector('[data-testid="indicador-clawback"][aria-hidden="true"]')).toBeTruthy();
    expect(resumo.textContent).toBe('Clawback');
    // `group-open:` só funciona com `group` no <details> (ancestral); no <summary> o indicador ficava preso em "+".
    const detalhes = resumo.parentElement as HTMLElement;
    expect(detalhes.tagName).toBe('DETAILS');
    expect(detalhes.className.split(/\s+/)).toContain('group');
    expect(resumo.className.split(/\s+/)).not.toContain('group');
    expect(resumo.querySelector('[data-testid="indicador-clawback"]')!.className).toContain('group-open:before:content-');
  });
  it('o h3 de "Incorporar nova cota" usa o papel de label, não text-lg ad hoc', () => {
    expect(src('page.tsx')).not.toMatch(/<h3 className="[^"]*text-lg/);
  });
});

describe('a variante "operacao" do footer herda o container operacional (rebase sobre #146)', () => {
  const ISSUER = 'GCN34WOPABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMWLGA7E';
  it('operacao + operacional: as duas faixas (conteúdo e linha legal) usam 1440 + gutter fluido', () => {
    const { container } = render(<AppFooter issuerPubkey={ISSUER} variante="operacao" operacional />);
    expect(container.querySelector('footer')!.getAttribute('data-variante')).toBe('operacao');
    const html = container.innerHTML;
    expect((html.match(/max-w-\[var\(--workspace-max\)\] px-\[var\(--spacing-gutter-ui\)\]/g) ?? []).length).toBe(2);
    expect(html).not.toContain('max-w-6xl');
  });
  it('operacao sem a flag e compacto continuam em 1152 px', () => {
    for (const v of ['operacao', 'compacto'] as const) {
      const { container, unmount } = render(<AppFooter issuerPubkey={ISSUER} variante={v} operacional={v === 'compacto'} />);
      expect(container.innerHTML, v).toContain('max-w-6xl');
      expect(container.innerHTML, v).not.toContain('--workspace-max');
      unmount();
    }
  });
  it('o AppShell liga as duas coisas no /admin: variante operacao e container operacional', () => {
    const shell = readFileSync('components/AppShell.tsx', 'utf8');
    expect(shell).toMatch(/const variante = operacional \? 'operacao' : 'completo'/);
    expect(shell).toMatch(/<AppFooter issuerPubkey=\{issuerPubkey\} variante=\{variante\} operacional=\{operacional\}/);
  });
});
