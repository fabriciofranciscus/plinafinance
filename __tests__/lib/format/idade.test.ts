import { describe, it, expect } from 'vitest';
import { idadeAnos, isMaiorDeIdade, dataMaximaNascimentoISO } from '@/lib/format/idade';

// Construído via componentes locais (não string+Z) — o próprio módulo evita
// depender de conversão UTC↔local, e o teste precisa seguir a mesma regra.
const HOJE = new Date(2026, 6, 15, 12);

describe('idadeAnos', () => {
  it('calcula idade completa quando já fez aniversário este ano', () => {
    expect(idadeAnos('2000-01-01', HOJE)).toBe(26);
  });

  it('calcula idade completa quando ainda não fez aniversário este ano', () => {
    expect(idadeAnos('2000-12-31', HOJE)).toBe(25);
  });

  it('aniversário é hoje: já conta o ano', () => {
    expect(idadeAnos('2008-07-15', HOJE)).toBe(18);
  });

  it('data inválida retorna NaN', () => {
    expect(Number.isNaN(idadeAnos('não-é-data', HOJE))).toBe(true);
  });

  it('data inexistente (30 de fevereiro) retorna NaN', () => {
    expect(Number.isNaN(idadeAnos('2000-02-30', HOJE))).toBe(true);
  });
});

describe('isMaiorDeIdade', () => {
  it('exatamente 18 anos hoje é maior de idade', () => {
    expect(isMaiorDeIdade('2008-07-15', HOJE)).toBe(true);
  });

  it('17 anos (faz 18 amanhã) não é maior de idade', () => {
    expect(isMaiorDeIdade('2008-07-16', HOJE)).toBe(false);
  });

  it('menor de idade claramente (criança) retorna false', () => {
    expect(isMaiorDeIdade('2015-01-01', HOJE)).toBe(false);
  });

  it('data inválida retorna false, não lança', () => {
    expect(isMaiorDeIdade('lixo', HOJE)).toBe(false);
  });
});

describe('dataMaximaNascimentoISO', () => {
  it('retorna a data de 18 anos atrás em ISO', () => {
    expect(dataMaximaNascimentoISO(HOJE)).toBe('2008-07-15');
  });
});
