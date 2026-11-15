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

describe('páginas que mostram o nome ao cedente passam pelo helper (deriva)', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const ler = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

  it('acompanhar/[leadId]/page.tsx: cedenteNome = nomeDoCedente(lead.nome), nunca lead.nome cru', () => {
    const src = ler('app/vender/acompanhar/[leadId]/page.tsx');
    expect(src).toMatch(/cedenteNome: nomeDoCedente\(lead\.nome\)/);
    expect(src).not.toMatch(/cedenteNome: lead\.nome/);
  });

  it('api/conta/me devolve nomeDoCedente(user.nome)', () => {
    expect(ler('app/api/conta/me/route.ts')).toMatch(/nome: nomeDoCedente\(user\.nome\)/);
  });
});
