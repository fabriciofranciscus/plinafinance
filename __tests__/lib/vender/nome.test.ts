import { describe, expect, it } from 'vitest';
import { NOME_NAO_INFORMADO, nomeDoCedente } from '@/lib/vender/nome';

describe('nomeDoCedente: o e-mail nunca é nome (pós-cota 15/11)', () => {
  it('nome de verdade passa, aparado', () => {
    expect(nomeDoCedente('  Ana Souza ')).toBe('Ana Souza');
    expect(nomeDoCedente('João da Silva')).toBe('João da Silva');
  });
  it('vazio, só espaços, null e undefined → null', () => {
    for (const v of ['', '   ', null, undefined]) expect(nomeDoCedente(v)).toBeNull();
  });
  it('qualquer coisa com @ (e-mail, inclusive de conta de teste do login) → null', () => {
    for (const v of ['test-4872@privy.io', 'ana@exemplo.test', ' ana@exemplo.test ', 'Ana <ana@exemplo.test>']) {
      expect(nomeDoCedente(v)).toBeNull();
    }
  });
  it('o marcador "Nome não informado" também conta como sem nome', () => {
    expect(nomeDoCedente(NOME_NAO_INFORMADO)).toBeNull();
  });
});
