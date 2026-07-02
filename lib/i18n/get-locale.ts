import { headers } from 'next/headers';
import { LOCALE_HEADER, isValidLocale } from './cookie';
import type { Dictionary, Locale } from './types';
import { ptBR } from './dictionaries/pt-BR';
import { en } from './dictionaries/en';

const DICTIONARIES: Record<Locale, Dictionary> = { 'pt-BR': ptBR, en };

export async function getLocale(): Promise<Locale> {
  const h = await headers();
  const raw = h.get(LOCALE_HEADER);
  return isValidLocale(raw) ? raw : 'pt-BR';
}

export async function getDictionary(): Promise<{ locale: Locale; dict: Dictionary }> {
  const locale = await getLocale();
  return { locale, dict: DICTIONARIES[locale] };
}
