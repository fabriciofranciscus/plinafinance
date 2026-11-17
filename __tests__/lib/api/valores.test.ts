/**
 * Validadores de valor com o limite da COLUNA do banco (I3 do plano de auditoria de input): nunca uma regra de negócio inventada
 * (múltiplo de 1000 etc.). BRL = Decimal(15,2) → até 13 inteiros e 2 casas; fração de deságio = Decimal(5,4) → [0,1] com até
 * 4 casas; quantidade Stellar → até 12 inteiros e 7 casas (o mesmo regex do liquidar/build).
 */
import { describe, expect, it } from 'vitest';
import { DesagioColunaString, FracaoDesagioString, QuantidadeStellarString, ValorBrlString } from '@/lib/api/valores';

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('ValorBrlString (Decimal(15,2))', () => {
  it.each(['8', '500', '1234', '1234.5', '1234.56', '0', '0.01', '9999999999999', '9999999999999.99', '007'])('aceita %s', (v) => {
    expect(ok(ValorBrlString, v)).toBe(true);
  });
  it.each(['10000000000000', '1234.567', '0.001', '1e3', '-5', ' 5', '5 ', '1,5', '', '.5', '5.', 'abc', '0x10', 5, null, undefined])('recusa %j', (v) => {
    expect(ok(ValorBrlString, v)).toBe(false);
  });
  it('a mensagem diz o limite (sem eco do valor enviado)', () => {
    const r = ValorBrlString.safeParse('99999.9999');
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? '' : r.error.issues)).not.toMatch(/99999/);
  });
});

describe('DesagioColunaString (formato Decimal(5,4); a faixa [0,1] é do serviço)', () => {
  it.each(['0', '1', '0.2', '0.2345', '9.9999', '2', '1.0001'])('aceita %s (faixa não é checada aqui)', (v) => {
    expect(ok(DesagioColunaString, v)).toBe(true);
  });
  it.each(['10', '0.12345', '-0.1', '1e0', '', '.5', '5%', 'abc', 0.2])('recusa %j', (v) => {
    expect(ok(DesagioColunaString, v)).toBe(false);
  });
});

describe('FracaoDesagioString (Decimal(5,4), [0,1])', () => {
  it.each(['0', '1', '0.2', '0.20', '0.2345', '0.0001', '1.0', '1.0000', '0.9999'])('aceita %s', (v) => {
    expect(ok(FracaoDesagioString, v)).toBe(true);
  });
  it.each(['1.0001', '2', '10', '9.5', '0.12345', '-0.1', '1e0', '', '.5', '5%', 'abc', 0.2])('recusa %j', (v) => {
    expect(ok(FracaoDesagioString, v)).toBe(false);
  });
});

describe('QuantidadeStellarString (12 inteiros, 7 casas, > 0)', () => {
  it.each(['1', '0.0000001', '999999999999.9999999', '85.4921510', '0.5'])('aceita %s', (v) => {
    expect(ok(QuantidadeStellarString, v)).toBe(true);
  });
  it.each(['0', '0.0000000', '0.00000001', '1234567890123', '1e3', '-1', ' 1', '1,5', '', '0x10', 'Infinity', 1])('recusa %j', (v) => {
    expect(ok(QuantidadeStellarString, v)).toBe(false);
  });
});
