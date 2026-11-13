import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/dictionaries/en';
import { ptBR } from '@/lib/i18n/dictionaries/pt-BR';

/**
 * Caminhos de todas as folhas. Arrays contam pelo tamanho, exceto os títulos:
 * a quantidade de linhas pode diferir entre idiomas (o EN quebra mais, em vez
 * de reduzir a fonte: SPEC §3).
 */
function shape(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    const titulo = path.endsWith('titulo');
    return [titulo ? `${path}[]` : `${path}[${value.length}]`, ...(titulo ? [] : value.flatMap((v, i) => shape(v, `${path}[${i}]`)))];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k));
  }
  return [path];
}

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

describe('landing v2 — dicionários', () => {
  it('PT e EN têm as mesmas chaves (títulos podem ter mais linhas no EN)', () => {
    expect(shape(en.landingV2)).toEqual(shape(ptBR.landingV2));
    expect(shape(en.meta)).toEqual(shape(ptBR.meta));
  });

  it('nenhum texto está vazio', () => {
    for (const dict of [ptBR, en]) {
      expect(leaves(dict).filter((t) => t.trim() === '')).toEqual([]);
    }
  });

  it('o modelo de e-mail mantém as variáveis que o formulário preenche', () => {
    for (const dict of [ptBR, en]) {
      const { corpo, assunto, linhaOrganizacao } = dict.landingV2.contato.mailto;
      for (const v of ['{nome}', '{email}', '{interesse}', '{organizacao}', '{mensagem}']) {
        expect(corpo).toContain(v);
      }
      expect(assunto).toContain('{interesse}');
      expect(linhaOrganizacao).toContain('{organizacao}');
    }
  });

  it('o aviso "não envia nem armazena" vale só enquanto o formulário for mailto (LD4c remove)', () => {
    expect(ptBR.landingV2.contato.form.avisoMailto).toMatch(/não envia nem armazena/);
    expect(en.landingV2.contato.form.avisoMailto).toMatch(/does not send or store/);
  });
});
