import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ptBR } from '@/lib/i18n/dictionaries/pt-BR';
import { en } from '@/lib/i18n/dictionaries/en';

/** QA Vera — LV9: a página RENDERIZADA (PT e EN), não só o dicionário. */
const st = vi.hoisted(() => ({ locale: 'pt-BR' as 'pt-BR' | 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/set-locale', () => ({ setLocale: vi.fn() }));
vi.mock('@/lib/i18n/get-locale', async () => {
  const pt = (await import('@/lib/i18n/dictionaries/pt-BR')).ptBR;
  const e = (await import('@/lib/i18n/dictionaries/en')).en;
  return { getDictionary: async () => ({ locale: st.locale, dict: st.locale === 'en' ? e : pt }) };
});
vi.mock('@/components/landing/landing.css', () => ({}));

import PrivacidadePage from '@/app/privacidade/page';
import { readFileSync } from 'node:fs';

async function html(locale: 'pt-BR' | 'en') {
  st.locale = locale;
  return renderToStaticMarkup(await PrivacidadePage());
}

describe('/privacidade renderizada', () => {
  for (const loc of ['pt-BR', 'en'] as const) {
    it(`${loc}: sem chave aberta, sem "undefined/null/[object", com h1, 7 seções e as marcas do texto base`, async () => {
      const h = await html(loc);
      const texto = h.replace(/<[^>]+>/g, ' ');
      expect(texto).not.toMatch(/[{}]|undefined|null|\[object|TODO|lorem/i);
      expect(h.match(/<h1/g)).toHaveLength(1);
      expect(h.match(/<h2/g)).toHaveLength(7);
      expect(h).toContain('contato@plina.finance');
      expect(h).toContain(loc === 'en' ? 'Plina Finance (a project in its testing phase, company being incorporated)' : 'Plina Finance (projeto em fase de testes, empresa em constituição)');
    });
    it(`${loc}: sem recurso externo (nenhum src/href http(s) fora do próprio site) e sem script`, async () => {
      const h = await html(loc);
      const urls = [...h.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      for (const u of urls) expect(u.startsWith('http'), u).toBe(false);
      expect(h).not.toMatch(/<script|<iframe|<img/i);
    });
    it(`${loc}: seletor de idioma acessível (grupo rotulado, aria-current no idioma ativo) e link para voltar ao início`, async () => {
      const h = await html(loc);
      expect(h).toMatch(/role="group"/);
      expect(h).toMatch(new RegExp(`lang="${loc === 'en' ? 'en' : 'pt-BR'}"[^>]*aria-current="true"|aria-current="true"[^>]*lang="${loc === 'en' ? 'en' : 'pt-BR'}"`));
      expect(h).toContain('href="/"');
    });
  }
  it('o rodapé da landing aponta para /privacidade nos dois idiomas e o rótulo existe nos dois dicionários', () => {
    const foot = readFileSync(new URL('../../components/landing/LandingFooter.tsx', import.meta.url), 'utf8');
    expect(foot).toContain('href="/privacidade"');
    expect(ptBR.landingV2.footer?.privacidade ?? (ptBR as never as { landingV2: { footer: Record<string, string> } }).landingV2.footer.privacidade).toBe('Privacidade');
    expect(en.landingV2.footer?.privacidade ?? (en as never as { landingV2: { footer: Record<string, string> } }).landingV2.footer.privacidade).toBe('Privacy');
  });
  it('/privacidade fica fora do AppShell e no matcher do proxy (mesma regra da landing)', () => {
    const shell = readFileSync(new URL('../../components/AppShell.tsx', import.meta.url), 'utf8');
    const prox = readFileSync(new URL('../../proxy.ts', import.meta.url), 'utf8');
    expect(shell).toMatch(/ROUTES_WITHOUT_SHELL = \[[^\]]*'\/privacidade'/);
    expect(prox).toMatch(/matcher: \[[^\]]*'\/privacidade'/);
  });
});
