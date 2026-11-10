import { describe, expect, it } from 'vitest';
import { renderInternalNotification, renderInvestorReply, type LeadData } from '@/app/actions/email-templates';

/**
 * LD0: a auto-resposta sai para TERCEIROS e o e-mail interno vira relatório. Nenhum dos dois
 * pode carregar vocabulário de oferta (a página "não tem oferta"). Falha se qualquer termo
 * proibido aparecer no assunto, no texto ou no HTML.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PROIBIDOS_RESPOSTA = [
  'plina-rf', 'plinarf', 'fidc', 'cvm 175', 'oferta restrita', 'investidor qualificado',
  'roadshow', 'big four', 'em ate 48', '48 horas', 'expression of interest',
  'tiquete', 'manifestacao de interesse', 'documentacao do',
];
const PROIBIDOS_INTERNO = [
  'plina-rf', 'plinarf', 'fidc', 'cvm 175', 'oferta restrita', 'investidor qualificado',
  'expression of interest', 'tiquete',
];

const base: LeadData = {
  name: 'Fulana de Teste',
  org: 'Organização Exemplo',
  email: 'fulana@example.com',
  profile: 'Family office brasileiro',
  recebido: '2026-11-10T12:00:00.000Z',
};
const legado: LeadData = {
  ...base,
  jurisdiction: 'Brasil',
  ticket: 'US$ 1M – 5M',
  currency: 'USD',
  classe: 'A',
  timeline: '3 meses',
};

const casos: Array<[string, LeadData]> = [
  ['só os campos obrigatórios', base],
  ['com jurisdição', { ...base, jurisdiction: 'Brasil' }],
  ['lead legado (tíquete, moeda, classe e prazo)', legado],
];

describe('auto-resposta ao lead (LD0)', () => {
  it.each(casos)('sem termos de oferta — %s', (_nome, lead) => {
    const r = renderInvestorReply(lead);
    const tudo = norm([r.subject, r.text, r.html].join('\n'));
    for (const termo of PROIBIDOS_RESPOSTA) expect(tudo, termo).not.toContain(termo);
    expect(tudo).not.toMatch(/\beoi\b/);
  });

  it('lead legado: não ecoa tíquete, moeda, classe nem prazo na auto-resposta', () => {
    const r = renderInvestorReply(legado);
    const tudo = [r.subject, r.text, r.html].join('\n');
    for (const valor of ['US$ 1M', 'USD', '3 meses']) expect(tudo).not.toContain(valor);
  });

  it('diz que é contato exploratório, sem oferta e sem prazo prometido, e traz o aviso de privacidade', () => {
    const r = renderInvestorReply(base);
    expect(r.subject).toBe('Plina · Recebemos seu contato');
    for (const corpo of [r.text, r.html]) {
      expect(corpo).toContain('assim que possível');
      expect(corpo).toContain('não há oferta em andamento');
      expect(corpo).toContain('eliminação dos seus dados');
    }
  });

  it('mantém organização, perfil e jurisdição (se houver) no resumo', () => {
    const r = renderInvestorReply({ ...base, jurisdiction: 'Brasil' });
    for (const corpo of [r.text, r.html]) {
      expect(corpo).toContain('Organização Exemplo');
      expect(corpo).toContain('Family office brasileiro');
      expect(corpo).toContain('Brasil');
    }
  });
});

describe('e-mail interno ao time (LD0)', () => {
  it.each(casos.slice(0, 2))('sem termos de oferta e sem tíquete — %s', (_nome, lead) => {
    const r = renderInternalNotification(lead);
    const tudo = norm([r.subject, r.text, r.html].join('\n'));
    for (const termo of PROIBIDOS_INTERNO) expect(tudo, termo).not.toContain(termo);
    expect(tudo).not.toMatch(/\beoi\b/);
    expect(r.subject).toBe('[Plina · Contato] Organização Exemplo');
  });

  it('lead legado: o tíquete aparece só como dado do lead, sem vocabulário de oferta no resto', () => {
    const r = renderInternalNotification(legado);
    expect(r.text).toContain('Tíquete: US$ 1M – 5M');
    const semTiquete = norm([r.subject, r.text, r.html].join('\n').replace(/t[ií]quete/gi, ''));
    for (const termo of PROIBIDOS_INTERNO.filter((t) => t !== 'tiquete')) {
      expect(semTiquete, termo).not.toContain(termo);
    }
  });
});
