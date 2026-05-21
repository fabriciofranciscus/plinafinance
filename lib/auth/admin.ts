/**
 * Auth do painel da operação Plina — POC.
 *
 * Cookie httpOnly `plina_admin` carrega um sessionId opaco (32 bytes hex).
 * Validade real fica em `AdminSession` no Postgres (criadoEm/expiraEm/
 * revogadoEm) → logout invalida server-side, não dá pra replay até maxAge.
 *
 * Decisão pendente do SPECS_MVP_TECH.md §6: trocar por Clerk/Auth.js
 * no MVP. POC fica nessa senha única — Plina interna.
 */

import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { db } from '../db';

export const ADMIN_COOKIE = 'plina_admin';
const COOKIE_MAX_AGE_SECONDS = 4 * 60 * 60; // 4h

export async function isAdminAuthenticated(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  const cookieStore = await cookies();
  const cookie = cookieStore.get(ADMIN_COOKIE);
  if (!cookie?.value) return false;
  const session = await db.adminSession.findUnique({
    where: { sessionId: cookie.value },
    select: { revogadoEm: true, expiraEm: true },
  });
  if (!session) return false;
  if (session.revogadoEm) return false;
  if (session.expiraEm <= new Date()) return false;
  return true;
}

export async function setAdminCookie() {
  const sessionId = randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000);
  await db.adminSession.create({ data: { sessionId, expiraEm } });
  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ADMIN_COOKIE);
  if (existing?.value) {
    await db.adminSession.updateMany({
      where: { sessionId: existing.value, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }
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
