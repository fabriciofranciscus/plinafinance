import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * /pool (LD0b-pool, Consuelo M1/M2/B1): guarda de fonte, porque a página é um Server Component
 * com banco e Horizon. Garante que (1) o valor por token tem casas decimais (o "R$ 0" de
 * produção vinha de um formatador de 0 casas), (2) o supply vem da MESMA leitura da API, e (3) o
 * texto não volta a ter os termos barrados.
 */
const src = readFileSync('app/pool/page.tsx', 'utf8');
const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('app/pool/page.tsx', () => {
  it('o valor por token usa 4 casas decimais e não o formatador inteiro', () => {
    expect(semComentarios).toMatch(/const navUnitLabel = navUnit === null \? '—' : brlPorToken\(navUnit\)/);
    expect(semComentarios).toMatch(/minimumFractionDigits: 4/);
    // o Intl de 4 casas escreve 0,1524 como "R$ 0,1524", nunca "R$ 0"
    const f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(0.1524);
    expect(f.replace(/\s/g, ' ')).toBe('R$ 0,1524');
  });

  it('lê o supply por lerSupplyDoNav (como a API) e o caixa do razão; sem a leitura direta antiga', () => {
    expect(semComentarios).toMatch(/lerSupplyDoNav\(\)/);
    expect(semComentarios).toMatch(/caixaParaNav\(\)/);
    expect(semComentarios).not.toMatch(/fetchSupplyOnChainFromEnv/);
  });

  it('o denominador diz circulante + tesouraria e há texto de conferência quando o NAV está indisponível', () => {
    expect(semComentarios).toMatch(/Number\(supply\.circulante\) \+ Number\(supply\.tesouraria\)/);
    expect(semComentarios).toMatch(/Valor por token em conferência/);
    expect(semComentarios).toMatch(/Valor do pool ÷/);
  });

  it('o cartão "emitido" usa o supply do ledger (o mesmo do denominador), não os tokens das cotas do banco', () => {
    expect(semComentarios).toMatch(/const tokensNoLedger = supply \? Number\(supply\.circulante\) \+ Number\(supply\.tesouraria\) : null/);
    expect(semComentarios).not.toMatch(/tokensEmitidosVivos/);
  });

  it('sem os termos barrados (R$ 1,00 de NAV, yield, institucional, FIDC, qualificados, capital próprio)', () => {
    expect(semComentarios).not.toMatch(/R\$ 1,00|yield|institucional|FIDC|qualificad|capital próprio|Em liquidação|Baixada|gestor do/i);
  });
});
