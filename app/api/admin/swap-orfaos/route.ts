/**
 * POST /api/admin/swap-orfaos — reconcilia reservas órfãs do swap de subscrição (N1).
 *
 * Só com prova on-chain: tx com sucesso → escritura; com falha, ou vencida e fora da chain → libera a
 * reserva. Enquanto houver reserva órfã o NAV fica indisponível (SWAP_EM_VOO), então o operador roda
 * isto quando o alarme/`/pool` indicar. Resposta: contagens (sem PII). Auth admin + CSRF.
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
