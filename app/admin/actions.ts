'use server';

/**
 * Server Actions do /admin.
 *
 * Auth: passwordLoginAction + logoutAction.
 * Operação: incorporarCotaAction + executarClawbackAction + atualizarStatusAction.
 *
 * Cada mutação revalida `/admin` e `/pool` para refletir mudanças
 * (incorporação muda NAV, clawback muda saldo investidor).
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearAdminCookie,
  isAdminAuthenticated,
  passwordMatches,
  setAdminCookie,
} from '@/lib/auth/admin';
import { createRateLimiter } from '@/lib/rate-limit/in-memory';
import {
  atualizarStatusCota,
  executarClawback,
  incorporarCota,
} from '@/lib/services/tokenizacao';
import { registrarValidacaoLegal } from '@/lib/services/originacao';
import { CaminhoRealizacao, MotivoClawback, StatusCota, TipoBem } from '@prisma/client';

export interface ActionResult {
  ok: boolean;
  error?: string;
  txHash?: string;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

// C-05: rate-limit em tentativas de senha. 5 falhas / 15 min por IP.
// Next 16 Server Actions já têm CSRF protection automática (origin check),
// então o gap restante é só brute-force. In-memory é OK pra POC (Fluid
// Compute reusa instância); produção real → Upstash/KV.
const loginRateLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60_000,
});

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() ?? 'unknown';
}

export async function passwordLoginAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ip = await getClientIp();
  if (!loginRateLimiter.consume(ip)) {
    return {
      ok: false,
      error: 'Muitas tentativas. Tente novamente em alguns minutos.',
    };
  }
  const password = formData.get('password');
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Senha obrigatória.' };
  }
  if (!passwordMatches(password)) {
    return { ok: false, error: 'Senha inválida.' };
  }
  // Sucesso: reset do bucket pra esse IP — não penaliza usuário legítimo
  // que acabou de errar uma vez antes.
  loginRateLimiter.reset(ip);
  await setAdminCookie();
  redirect('/admin');
}

export async function logoutAction() {
  await clearAdminCookie();
  redirect('/admin');
}

// ─── Operação ───────────────────────────────────────────────────────────────

async function ensureAuth() {
  if (!(await isAdminAuthenticated())) {
    throw new Error('Não autorizado.');
  }
}

export async function incorporarCotaAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await ensureAuth();
  try {
    const result = await incorporarCota({
      tipoBem: formData.get('tipoBem') as TipoBem,
      administradora: String(formData.get('administradora') ?? '').trim(),
      valorCarta: String(formData.get('valorCarta') ?? ''),
      desagioAquisicao: String(formData.get('desagioAquisicao') ?? ''),
      desagioRevenda:
        String(formData.get('desagioRevenda') ?? '').trim() || undefined,
      localizacaoAprox:
        String(formData.get('localizacaoAprox') ?? '').trim() || undefined,
      prazoRestanteMeses:
        Number(formData.get('prazoRestanteMeses')) || undefined,
      caminhoPrevisto:
        (formData.get('caminhoPrevisto') as CaminhoRealizacao) ?? 'A_REVENDA',
      notas: String(formData.get('notas') ?? '').trim() || undefined,
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function executarClawbackAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await ensureAuth();
  try {
    const result = await executarClawback({
      investidorId: String(formData.get('investidorId') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      motivo: formData.get('motivo') as MotivoClawback,
      fundamentoUrl: String(formData.get('fundamentoUrl') ?? '').trim(),
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function registrarValidacaoLegalAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await ensureAuth();
  try {
    const result = await registrarValidacaoLegal({
      cotaId: String(formData.get('cotaId') ?? ''),
      laudoUrl: String(formData.get('laudoUrl') ?? '').trim(),
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function atualizarStatusCotaAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await ensureAuth();
  try {
    await atualizarStatusCota({
      cotaId: String(formData.get('cotaId') ?? ''),
      status: formData.get('status') as StatusCota,
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}
