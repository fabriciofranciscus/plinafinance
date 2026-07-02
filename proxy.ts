import { NextResponse, type NextRequest } from 'next/server';
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isValidLocale,
  resolveLocaleFromAcceptLanguage,
} from './lib/i18n/cookie';

// Só a landing (`/`) tem i18n por enquanto — ver matcher abaixo.
export function proxy(request: NextRequest) {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isValidLocale(cookieLocale)
    ? cookieLocale
    : resolveLocaleFromAcceptLanguage(request.headers.get('accept-language'));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

export const config = {
  matcher: ['/'],
};
