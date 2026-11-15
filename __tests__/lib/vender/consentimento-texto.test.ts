import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as texto from '@/lib/vender/consentimento-texto';
import * as consentimento from '@/lib/vender/consentimento';

describe('consentimento-texto: única fonte, importável pelo navegador (Flora)', () => {
  // Só o CÓDIGO conta: os comentários citam `node:crypto` justamente para explicar por que ele não pode aparecer aqui.
  const fonte = readFileSync(join(process.cwd(), 'lib/vender/consentimento-texto.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('não importa nada de servidor (sem node:*, sem crypto, sem db) — o bundle do cliente não quebra', () => {
    const imports = fonte.split('\n').filter((l) => /^\s*(import|export)\s.*\sfrom\s/.test(l) || /^\s*import\s+['"]/.test(l));
    expect(imports).toEqual([]);
    expect(fonte).not.toMatch(/node:|require\(|process\.env/);
  });

  it('só exporta o texto e a flag de aprovação', () => {
    expect(Object.keys(texto).sort()).toEqual(['TEXTO_CONSENTIMENTO_APROVADO', 'TEXTO_CONSENTIMENTO_LGPD']);
    expect(typeof texto.TEXTO_CONSENTIMENTO_LGPD).toBe('string');
    expect(texto.TEXTO_CONSENTIMENTO_LGPD.length).toBeGreaterThan(50);
  });

  it('consentimento.ts reexporta os MESMOS valores (uma fonte só) e a versão é o hash do texto', () => {
    expect(consentimento.TEXTO_CONSENTIMENTO_LGPD).toBe(texto.TEXTO_CONSENTIMENTO_LGPD);
    expect(consentimento.TEXTO_CONSENTIMENTO_APROVADO).toBe(texto.TEXTO_CONSENTIMENTO_APROVADO);
    expect(consentimento.VERSAO_CONSENTIMENTO_LGPD).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enquanto o texto não for aprovado a flag fica false (a tela não o exibe e a mainnet recusa)', () => {
    expect(texto.TEXTO_CONSENTIMENTO_APROVADO).toBe(false);
  });
});
