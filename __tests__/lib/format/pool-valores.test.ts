import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brl, tokenFmt } from '@/lib/format/pool';

// /pool: a cota 2 vale 5,04 (NAV e tokens) e aparecia como "R$ 5 / 5 PLINA-RF" porque os formatadores tinham 0 casas.
// Só exibição: nenhum valor é calculado aqui; o número já vem pronto do servidor.
const nb = (s: string) => s.replace(/\s/g, ' ');

describe('brl (valores em reais do /pool)', () => {
  it('mostra os centavos: 5,04 nunca vira "R$ 5"', () => {
    expect(nb(brl(5.04))).toBe('R$ 5,04');
  });
  it('mantém os valores redondos legíveis, agora com ,00', () => {
    expect(nb(brl(200000))).toBe('R$ 200.000,00');
    expect(nb(brl(0))).toBe('R$ 0,00');
  });
  it('não arredonda para cima nem para baixo dentro de 2 casas', () => {
    expect(nb(brl(1234.56))).toBe('R$ 1.234,56');
    expect(nb(brl(0.99))).toBe('R$ 0,99');
  });
});

describe('tokenFmt (PLINA-RF emitido)', () => {
  it('mostra as casas do token: 5,04 nunca vira "5"', () => {
    expect(tokenFmt(5.04)).toBe('5,04');
  });
  it('inteiros continuam sem casas e com milhar', () => {
    expect(tokenFmt(200000)).toBe('200.000');
    expect(tokenFmt(0)).toBe('0');
  });
  it('vai até as 7 casas da Stellar, sem zeros à direita', () => {
    expect(tokenFmt(0.1234567)).toBe('0,1234567');
    expect(tokenFmt(1.5)).toBe('1,5');
  });
});

describe('o /pool usa esses formatadores (e não os de 0 casas)', () => {
  const page = readFileSync('app/pool/page.tsx', 'utf8');
  it('importa brl e tokenFmt de lib/format/pool e não os redefine com 0 casas', () => {
    expect(page).toMatch(/import \{[^}]*\bbrl\b[^}]*\btokenFmt\b[^}]*\} from '@\/lib\/format\/pool'/);
    expect(page).not.toMatch(/function brl\(/);
    expect(page).not.toMatch(/function tokenFmt\(/);
    expect(page).not.toMatch(/maximumFractionDigits: 0/);
  });
  it('cada KPI do topo usa o formatador certo (nenhum cai em Math.round / String)', () => {
    expect(page).toMatch(/value=\{brl\(navTotal\)\}/);
    expect(page).toMatch(/value=\{tokensNoLedger === null \? '—' : tokenFmt\(tokensNoLedger\)\}/);
    expect(page).toMatch(/value=\{brl\(caixa\)\}/);
    expect(page).toMatch(/value=\{brl\(spreadAcumulado\)\}/);
    expect(page).toMatch(/value=\{navUnitLabel\}/);
    expect(page).not.toMatch(/Math\.round\(|toFixed\(0\)/);
  });
  it('a linha da cota mostra NAV e tokens pelos mesmos formatadores', () => {
    expect(page).toMatch(/<Td mono>\{brl\(nav\)\}<\/Td>/);
    expect(page).toMatch(/<Td mono>\{tokenFmt\(Number\(c\.tokensEmitidos\)\)\}<\/Td>/);
  });
});
