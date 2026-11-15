import { describe, expect, it } from 'vitest';
import { itemAtivo, itensDoMenu } from '@/lib/nav/menu';

const base = { isAdmin: false, authenticated: true, carregandoPapeis: false };
const rotulos = (papeis: string[], extra: Partial<typeof base> = {}) =>
  itensDoMenu({ ...base, ...extra, papeis }).map((i) => i.label);

describe('itensDoMenu (spec de UX §1.1)', () => {
  it('investidor: Início · Investir · Sacar · Histórico', () => {
    expect(rotulos(['INVESTIDOR'])).toEqual(['Início', 'Investir (testnet)', 'Sacar (testnet)', 'Histórico']);
  });
  it('cedente: Início · Vender · Minhas solicitações · Histórico (sem Investir nem Sacar)', () => {
    expect(rotulos(['CEDENTE'])).toEqual(['Início', 'Vender', 'Minhas solicitações', 'Histórico']);
  });
  it('os dois papéis: todos os seis, nesta ordem', () => {
    expect(rotulos(['INVESTIDOR', 'CEDENTE'])).toEqual([
      'Início', 'Investir (testnet)', 'Sacar (testnet)', 'Vender', 'Minhas solicitações', 'Histórico',
    ]);
  });
  it('conta sem papel: Início · Investir · Vender · Histórico (quem chega para vender acha o caminho)', () => {
    expect(rotulos([])).toEqual(['Início', 'Investir (testnet)', 'Vender', 'Histórico']);
  });
  it('papéis ainda carregando: só Início e Histórico', () => {
    expect(rotulos([], { carregandoPapeis: true })).toEqual(['Início', 'Histórico']);
  });
  it('/sacar é alcançável pelo menu do investidor', () => {
    expect(itensDoMenu({ ...base, papeis: ['INVESTIDOR'] }).find((i) => i.label.startsWith('Sacar'))?.href).toBe('/sacar');
  });
  it('deslogado mantém o menu público; admin mantém Operação · Pool', () => {
    // A-09: o acesso secundário a /vender/minhas fica no menu público, sem simular sessão
    expect(rotulos([], { authenticated: false })).toEqual(['Pool', 'Cotas', 'Política', 'Investir (testnet)', 'Minhas solicitações']);
    expect(itensDoMenu({ ...base, authenticated: false, papeis: [] }).find((i) => i.label === 'Minhas solicitações')?.href).toBe('/vender/minhas');
    expect(rotulos(['INVESTIDOR'], { isAdmin: true })).toEqual(['Operação', 'Pool']);
  });
});

describe('itemAtivo: só o link mais específico acende', () => {
  const itens = itensDoMenu({ ...base, papeis: ['CEDENTE'] });
  it('em /vender/minhas acende Minhas solicitações, não Vender', () => {
    expect(itemAtivo('/vender/minhas', '/vender/minhas', itens)).toBe(true);
    expect(itemAtivo('/vender', '/vender/minhas', itens)).toBe(false);
  });
  it('em /vender e em /vender/acompanhar/x acende Vender', () => {
    expect(itemAtivo('/vender', '/vender', itens)).toBe(true);
    expect(itemAtivo('/vender', '/vender/acompanhar/abc', itens)).toBe(true);
  });
  it('/inicio não acende em /investir', () => {
    expect(itemAtivo('/inicio', '/investir', itens)).toBe(false);
  });
});
