/**
 * Auth do painel da operação Plina — POC.
 *
 * Cookie httpOnly `plina_admin` armazena hash do ADMIN_PASSWORD. Server
 * compara via re-hash. Não vaza a senha se o cookie for lido por error
 * (httpOnly impede JS, mas defesa em profundidade).
 *
 * Decisão pendente do SPECS_MVP_TECH.md §6: trocar por Clerk/Auth.js
 * no MVP. POC fica nessa senha única — Plina interna.
 */

import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';

export const ADMIN_COOKIE = 'plina_admin';
const COOKIE_MAX_AGE_SECONDS = 4 * 60 * 60; // 4h

function expectedHash(): string {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) {
    throw new Error('ADMIN_PASSWORD não configurada no .env.local.');
  }
  return createHash('sha256').update(`plina:${pwd}`).digest('hex');
}

export async function isAdminAuthenticated(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  const cookieStore = await cookies();
  const cookie = cookieStore.get(ADMIN_COOKIE);
  if (!cookie?.value) return false;
  return cookie.value === expectedHash();
}

export async function setAdminCookie() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_COOKIE,
    value: expectedHash(),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
  });
}

/** Verifica senha pura contra ADMIN_PASSWORD env. */
export function passwordMatches(provided: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
