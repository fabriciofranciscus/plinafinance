/**
 * POST /api/admin/swap-orfaos — reconcilia reservas órfãs do swap de subscrição (N1).
 *
 * Prova pela conta do investidor: sucesso → escritura; falha, ou sequence consumida por outra tx → libera;
 * sequence livre depois de maxTime + espera → libera por tempo e vigia o hash por 24 h (sucesso depois →
 * escritura + alerta); sem dado conclusivo → fica órfã (operador, runbook). Enquanto houver reserva órfã o
 * NAV fica indisponível (SWAP_EM_VOO). Resposta: contagens (sem PII). Auth admin + CSRF.
 */

import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';
import { reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await reconciliarSwapsOrfaos());
  } catch (err) {
    console.error('[admin/swap-orfaos]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
