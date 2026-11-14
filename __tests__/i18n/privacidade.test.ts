import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/dictionaries/en';
import { ptBR } from '@/lib/i18n/dictionaries/pt-BR';

function folhas(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (o && typeof o === 'object') return Object.values(o).flatMap(folhas);
  return [];
}
function formato(o: unknown, p = ''): string[] {
  if (typeof o === 'string') return [p];
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => formato(v, p ? `${p}.${k}` : k));
  return [];
}

describe('/privacidade (LV9, versão base da Norma)', () => {
  it('PT e EN têm as mesmas chaves, nenhuma vazia', () => {
    expect(formato(en.privacidade)).toEqual(formato(ptBR.privacidade));
    for (const d of [ptBR, en]) expect(folhas(d.privacidade).filter((t) => !t.trim())).toEqual([]);
  });

  it('sem chave aberta no texto publicado (a Vera testa: nenhum { nem })', () => {
    for (const d of [ptBR, en]) {
      for (const t of folhas(d.privacidade)) expect(t).not.toMatch(/[{}]/);
    }
  });

  it('controladora, contato, medição anônima e cookie de idioma; sem prazo numérico nem encarregado', () => {
    const pt = folhas(ptBR.privacidade).join('\n');
    expect(pt).toMatch(/Plina Finance \(projeto em fase de testes, empresa em constituição\)/);
    expect(pt).toContain('contato@plina.finance');
    expect(pt).toMatch(/sem query|parâmetro de busca e fragmento/);
    expect(pt).toMatch(/cookie funcional com o idioma/);
    expect(pt).toMatch(/não envia nem guarda o que você digita/);
    // sem prazo de guarda numérico (a sessão de 24 h da Vercel é a única hora citada) e sem nomear encarregado
    expect(pt.replace(/descartada em 24 horas/g, '')).not.toMatch(/\b\d+\s*(dias|meses|anos|horas)\b/i);
    expect(pt).not.toMatch(/encarregado:|DPO:/i);
    // não afirma que o banco só tem dado fictício
    expect(pt).not.toMatch(/apenas dados fictícios no banco|só (há|tem) dados fictícios/i);
  });

  it('a página de privacidade usa os termos da landing sem promessa nem oferta (só na negação)', () => {
    for (const d of [ptBR, en]) {
      const t = folhas(d.privacidade).join('\n');
      expect(t).not.toMatch(/\b(FIDC|CVM 175|PLINA-RF|yield|retorno|rentabilidade|returns?)\b/i);
      // "investimento" só aparece na negação do estágio ("Não há oferta..."): aqui, nenhuma ocorrência
      expect(t).not.toMatch(/\binvestimento\b|\binvestment\b/i);
    }
  });

  it('rótulo do link do rodapé: Privacidade / Privacy', () => {
    expect(ptBR.landingV2.footer.privacidade).toBe('Privacidade');
    expect(en.landingV2.footer.privacidade).toBe('Privacy');
  });
});
