// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// I2 (achado BAIXO): o campo "Valor TESOURO a sacar" tinha step=0.01, mas o servidor aceita 7 casas (toFixed(7), a
// precisão da Stellar). Sem <form> o step não bloqueava nada, mas marcava o campo como inválido e as setas andavam 0,01.
const src = readFileSync('app/sacar/page.tsx', 'utf8');

/** Atributos `type/min/step` do input de valor, lidos do código. */
function atributosDoCampo(): Record<string, string> {
  const i = src.indexOf('value={amountTesouro}');
  expect(i).toBeGreaterThan(-1);
  const tag = src.slice(src.lastIndexOf('<input', i), i);
  const get = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(tag)?.[1];
  return { type: get('type') ?? '', min: get('min') ?? '', step: get('step') ?? '' };
}

const valido = (valor: string) => {
  const a = atributosDoCampo();
  const el = document.createElement('input');
  el.type = a.type;
  if (a.min) el.min = a.min;
  if (a.step) el.step = a.step;
  el.value = valor;
  return el.validity.valid;
};

describe('/sacar: campo de valor em TESOURO', () => {
  it('aceita qualquer saldo com até 7 casas (a precisão da Stellar e do toFixed(7) da rota)', () => {
    for (const v of ['10', '0.5', '42.83', '42.8349', '85.4871', '0.1234567', '1000000', '0.0000001']) expect(valido(v), v).toBe(true);
  });
  it('continua recusando zero, negativo e mais de 7 casas', () => {
    for (const v of ['0', '-1', '0.12345678']) expect(valido(v), v).toBe(false);
  });
});
