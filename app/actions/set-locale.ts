'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, isValidLocale } from '@/lib/i18n/cookie';

export async function setLocale(locale: string): Promise<void> {
  if (!isValidLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}
