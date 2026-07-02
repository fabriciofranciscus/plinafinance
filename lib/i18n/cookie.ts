import type { Locale } from './types';

export const LOCALE_COOKIE = 'plina_locale';
export const LOCALE_HEADER = 'x-plina-locale';
export const DEFAULT_LOCALE: Locale = 'en';

export function isValidLocale(value: string | undefined | null): value is Locale {
  return value === 'pt-BR' || value === 'en';
}

export function resolveLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'en';
  try {
    const primeiro = header
      .split(',')
      .map((tag) => {
        const [lang, ...params] = tag.trim().split(';');
        const qParam = params.find((p) => p.trim().startsWith('q='));
        const q = qParam ? Number(qParam.trim().slice(2)) : 1;
        return { lang: lang.trim(), q: Number.isFinite(q) ? q : 1 };
      })
      .filter((t) => t.lang.length > 0)
      .sort((a, b) => b.q - a.q)[0];

    if (primeiro?.lang.toLowerCase().startsWith('pt')) return 'pt-BR';
    return 'en';
  } catch {
    return 'en';
  }
}
