/**
 * Aporte da cota (carta × (1 − deságio)) como função PURA, sem Prisma, para a Revisão do /admin mostrar o MESMO número que o servidor
 * grava (opção (b) da Íris, #157). Contrato: igual a `navDaCotaAsDecimal` (Decimal, 2 casas, meio-par) em TODO valor dentro dos
 * limites das colunas (carta ≤ 13 inteiros e 2 casas; deságio ≤ 4 casas), inclusive nos meios exatos onde a conta em ponto flutuante
 * divergia em R$ 0,01. Entrada inválida ou aporte não positivo → null (a tela mostra "—"; o servidor recusaria).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { aporteDaCotaBrl } from '@/lib/services/aporte';
import { navDaCotaAsDecimal } from '@/lib/services/pool';

const servidor = (carta: string, des: string) => navDaCotaAsDecimal({ valorCarta: carta, desagioAquisicao: des }).toFixed(2);

describe('aporteDaCotaBrl — igual ao servidor', () => {
  it.each([
    ['100000', '0.2000', '80000.00'],
    ['100000', '0.20', '80000.00'],
    ['100000', '0.2', '80000.00'],
    ['250000', '0.1800', '205000.00'],
    ['8', '0', '8.00'],
    ['8', '0.5', '4.00'],
    ['1234.50', '0.3333', '823.04'],
    ['9999999999999.99', '0.0001', '9999999999999.99'.replace('9999999999999.99', servidor('9999999999999.99', '0.0001'))],
  ])('carta %s deságio %s → %s', (carta, des, esperado) => {
    expect(aporteDaCotaBrl(carta, des)).toBe(esperado);
    expect(aporteDaCotaBrl(carta, des)).toBe(servidor(carta, des));
  });

  // Os "meios exatos": o produto termina em 5 na 3ª casa. Meio-par do servidor; o ponto flutuante da tela arredondava para cima.
  it.each([
    ['100.01', '0.5000', '50.00'], // 50.005 → par (50.00)
    ['100.05', '0.5000', '50.02'], // 50.025 → par (50.02)
    ['2.50', '0.9900', '0.02'],    // 0.025  → par (0.02)
    ['0.03', '0.5000', '0.02'],    // 0.015  → par (0.02)
    ['0.01', '0.5000', '0.00'],    // 0.005 → par (0.00): aporte 0 ⇒ null abaixo
  ])('meio exato: carta %s deságio %s → servidor e função dão %s', (carta, des, esperado) => {
    expect(servidor(carta, des)).toBe(esperado);
    const r = aporteDaCotaBrl(carta, des);
    expect(r).toBe(esperado === '0.00' ? null : esperado);
  });

  it('varredura: 30.000 casos (carta em centavos até R$ 5 mi, deságio de 0 a 1 com 4 casas) idênticos ao servidor, e todos os meios exatos', () => {
    let seed = 20261125;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let meios = 0;
    for (let i = 0; i < 30_000; i++) {
      const carta = (Math.floor(rnd() * 500_000_000) / 100).toFixed(2);
      const des = (Math.floor(rnd() * 10_001) / 10_000).toFixed(4);
      const s = servidor(carta, des);
      const r = aporteDaCotaBrl(carta, des);
      if (Number(s) <= 0) expect(r, `${carta}/${des}`).toBeNull();
      else expect(r, `${carta}/${des}`).toBe(s);
    }
    // meios exatos construídos: carta com centavos ímpares × deságio 0.5000 (produto termina em .xx5)
    for (let c = 1; c <= 9999; c += 2) {
      const carta = (100 + c / 100).toFixed(2);
      const s = servidor(carta, '0.5000');
      if (Number(servidor(carta, '0.5000')) > 0) expect(aporteDaCotaBrl(carta, '0.5000'), carta).toBe(s);
      meios++;
    }
    expect(meios).toBe(5000);
  });
});

describe('aporteDaCotaBrl — entrada inválida → null (a tela mostra "—")', () => {
  it.each([
    ['', '0.2'], ['100000', ''], [' 100000', '0.2'], ['100000 ', '0.2'], ['100000', ' 0.2'],
    ['abc', '0.2'], ['100000', 'abc'], ['1e5', '0.2'], ['100000', '1e-1'], ['0x10', '0.2'], ['1,5', '0.2'], ['100000', '0,2'],
    ['-100000', '0.2'], ['100000', '-0.1'], ['100000', '-0.0001'], ['100000', '1.0001'], ['100000', '2'], ['100000', '10'],
    ['1.234', '0.2'],            // carta com mais de 2 casas (coluna Decimal(15,2))
    ['10000000000000', '0.2'],   // 14 inteiros
    ['100000', '0.12345'],       // deságio com mais de 4 casas (coluna Decimal(5,4))
    ['100000', '1'],             // deságio 100%: aporte 0 ⇒ o servidor recusa (CUSTO_INVALIDO)
    ['0', '0.2'],                // carta 0
    ['.5', '0.2'], ['5.', '0.2'], ['1.2.3', '0.2'],
  ])('carta %j deságio %j → null', (carta, des) => {
    expect(aporteDaCotaBrl(carta, des)).toBeNull();
  });
  it.each([[undefined, '0.2'], ['100000', undefined], [null, null], [100000, 0.2]])('tipos que não são texto (%j, %j) → null, sem lançar', (carta, des) => {
    expect(aporteDaCotaBrl(carta as never, des as never)).toBeNull();
  });
});

describe('aporteDaCotaBrl — pura e importável na tela', () => {
  it('o módulo não importa nada (nem Prisma nem serviço): pode entrar no bundle do cliente', () => {
    const src = readFileSync('lib/services/aporte.ts', 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(|process\.env|@prisma/);
  });
});
