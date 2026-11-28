'use server';

/**
 * Server Actions do /admin.
 *
 * Auth: passwordLoginAction + logoutAction.
 * Operação: incorporarCotaAction + executarClawbackAction.
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
import { adminLoginLimiter } from '@/lib/rate-limit/config';
import { causaSegura } from '@/lib/api/causa-segura';
import { DesagioColunaString, ValorBrlString } from '@/lib/api/valores';
import {
  ClawbackError,
  executarClawback,
  IncorporacaoBloqueadaError,
  IncorporacaoEmissaoError,
  incorporarCota,
} from '@/lib/services/tokenizacao';
import { registrarValidacaoLegal } from '@/lib/services/originacao';
import { CaminhoRealizacao, MotivoClawback, TipoBem } from '@prisma/client';

export interface ActionResult {
  ok: boolean;
  error?: string;
  txHash?: string;
  /** Código fixo do erro: do clawback (PEDIDO_EM_ANDAMENTO, REGISTRO_PENDENTE…) ou de domínio (LAUDO_AUSENTE, EMISSAO_FALHOU…), quando houver. */
  code?: string;
  /** Só no clawback (U1-11): `true` quando o pedido já tinha sido executado. */
  idempotente?: boolean;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

// C-05: rate-limit em tentativas de senha. 5 falhas / 15 min por IP.
// Next 16 Server Actions já têm CSRF protection automática (origin check),
// então o gap restante é só brute-force. Backend é Upstash em prod
// (compartilhado entre instâncias Fluid Compute) e in-memory em dev/CI.
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
  if (!(await adminLoginLimiter.consume(ip))) {
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
  await adminLoginLimiter.reset(ip);
  await setAdminCookie();
  redirect('/admin');
}

export async function logoutAction() {
  await clearAdminCookie();
  redirect('/admin');
}

// ─── Operação ───────────────────────────────────────────────────────────────

/**
 * Erro FIXO para a tela (nunca `err.message` cru: Prisma ecoa valores, Stellar/anchor ecoam o que foi enviado, `Error` simples cita
 * ids e nomes de variável). Só as classes de domínio, que têm mensagem escrita por nós e sem dado de ninguém, devolvem a mensagem
 * (+ `code`); qualquer outra coisa vira 'erro interno' e a causa vai ao log sem mensagem.
 */
function erroFixoDeAcao(err: unknown, tag: string): ActionResult {
  if (err instanceof IncorporacaoBloqueadaError || err instanceof IncorporacaoEmissaoError) {
    return { ok: false, error: err.message, code: err.code };
  }
  console.error(`[admin/${tag}] erro interno`, causaSegura(err));
  return { ok: false, error: 'erro interno' };
}

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
  // Prazo: em branco = sem prazo; 0 = cota QUITADA (preservado, nunca trocado por "sem prazo"); inteiro 0..600 como na rota admin.
  const prazoBruto = String(formData.get('prazoRestanteMeses') ?? '').trim();
  let prazoRestanteMeses: number | undefined;
  if (prazoBruto !== '') {
    prazoRestanteMeses = /^\d{1,3}$/.test(prazoBruto) ? Number(prazoBruto) : NaN;
    if (!(prazoRestanteMeses >= 0 && prazoRestanteMeses <= 600)) {
      return { ok: false, error: 'Prazo inválido: informe um número inteiro de 0 a 600 (0 = cota quitada).' };
    }
  }
  // Carta e deságio no formato das colunas (o mesmo do aporte mostrado na Revisão): o Decimal do serviço aceitaria ".18", "1.8e-1"
  // ou "2.5e5", que a tela mostra como "—". Sem trim: o texto segue como veio. Faixa [0, 1] e custo positivo ficam no serviço.
  const valorCarta = ValorBrlString.safeParse(formData.get('valorCarta') ?? '');
  if (!valorCarta.success) return { ok: false, error: valorCarta.error.issues[0]!.message };
  const desagioAquisicao = DesagioColunaString.safeParse(formData.get('desagioAquisicao') ?? '');
  if (!desagioAquisicao.success) return { ok: false, error: desagioAquisicao.error.issues[0]!.message };
  try {
    const result = await incorporarCota({
      tipoBem: formData.get('tipoBem') as TipoBem,
      administradora: String(formData.get('administradora') ?? '').trim(),
      valorCarta: valorCarta.data,
      desagioAquisicao: desagioAquisicao.data,
      desagioRevenda:
        String(formData.get('desagioRevenda') ?? '').trim() || undefined,
      localizacaoAprox:
        String(formData.get('localizacaoAprox') ?? '').trim() || undefined,
      prazoRestanteMeses,
      caminhoPrevisto:
        (formData.get('caminhoPrevisto') as CaminhoRealizacao) ?? 'A_REVENDA',
      notas: String(formData.get('notas') ?? '').trim() || undefined,
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    return erroFixoDeAcao(err, 'incorporar-cota');
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
      // Chave de idempotência do PEDIDO (gerada pela tela): o mesmo pedido nunca executa duas vezes (U1-11).
      pedidoId: String(formData.get('pedidoId') ?? ''),
      // Carteira que o operador viu na revisão: o serviço recusa se divergir da lida agora (em branco = não enviada).
      carteiraRevisada: String(formData.get('carteiraRevisada') ?? '').trim() || undefined,
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash, ...(result.idempotente ? { idempotente: true } : {}) };
  } catch (err) {
    // Erro FIXO (nunca err.message cru: Prisma/Stellar ecoam valores, ids e nomes de variável). REGISTRO_PENDENTE leva o txHash
    // que já está na rede.
    if (err instanceof ClawbackError) {
      return { ok: false, error: err.message, code: err.code, ...(err.txHash ? { txHash: err.txHash } : {}) };
    }
    console.error('[admin/clawback] erro interno', causaSegura(err));
    return { ok: false, error: 'erro interno' };
  }
}

export async function registrarValidacaoLegalAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await ensureAuth();
  const laudoUrl = String(formData.get('laudoUrl') ?? '').trim();
  if (!/^https?:\/\//.test(laudoUrl)) {
    return { ok: false, error: 'laudoUrl obrigatória (URL pública do documento).' };
  }
  try {
    const result = await registrarValidacaoLegal({
      cotaId: String(formData.get('cotaId') ?? ''),
      laudoUrl,
      operador: 'admin-panel',
    });
    revalidatePath('/admin');
    revalidatePath('/pool');
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    return erroFixoDeAcao(err, 'validacao-legal');
  }
}
