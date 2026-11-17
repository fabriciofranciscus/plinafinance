import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// I2 (achado BAIXO): /comprar/lead deixava digitar além do limite do servidor e só então vinha o erro.
// O teste lê os limites do Zod da rota e exige o mesmo `maxLength` no campo da tela.
const rota = readFileSync('app/api/comprar/lead/route.ts', 'utf8');
const pagina = readFileSync('app/comprar/lead/page.tsx', 'utf8');

const limiteDoServidor = (campo: string): number => {
  const m = new RegExp(`\\b${campo}: z[^\\n]*?\\.max\\((\\d+)\\)`).exec(rota);
  expect(m, `limite de "${campo}" na rota`).not.toBeNull();
  return Number(m![1]);
};

/** Abertura da tag <input> cujo `value` é a variável de estado. */
const inputDe = (variavel: string): string => {
  const i = pagina.indexOf(`value={${variavel}}`);
  expect(i, `input com value={${variavel}}`).toBeGreaterThan(-1);
  const ini = pagina.lastIndexOf('<input', i);
  return pagina.slice(ini, pagina.indexOf('/>', i));
};

describe('/comprar/lead: maxLength igual ao limite do servidor', () => {
  it.each([
    ['nome', 'nome'],
    ['email', 'email'],
    ['telefone', 'telefone'],
    ['documento', 'documento'],
    ['intencaoBem', 'intencaoBem'],
  ])('%s', (campo, variavel) => {
    const limite = limiteDoServidor(campo);
    expect(inputDe(variavel)).toContain(`maxLength={${limite}}`);
  });

  it('os limites lidos são os esperados (se o servidor mudar, o teste avisa)', () => {
    expect([limiteDoServidor('nome'), limiteDoServidor('email'), limiteDoServidor('telefone'), limiteDoServidor('documento'), limiteDoServidor('intencaoBem')]).toEqual([200, 254, 40, 40, 500]);
  });
});
