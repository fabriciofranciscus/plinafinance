/**
 * GET /api/ops/reconciliar-subscricoes — varredor periódico das reservas órfãs do swap de subscrição (N1).
 *
 * Disparado por agendador (GitHub Actions a cada 10 min, Farol) com `Authorization: Bearer <OPS_CRON_SECRET>`;
 * 404 sem ele. Aplica os desfechos do contrato (alarme-emissao-pendente, extensão N1): tx on-chain com sucesso
 * → escritura; falha, ou sequence do investidor consumida por outra tx → libera; sequence livre 10 min depois
 * de um ledger com closed_at > maxTime → libera por tempo e vigia o hash por 24 h; inconclusivo → fica e conta
 * em `vencidasSemProva` (operador). Resposta: SÓ contagens, sem PII.
 */

import { NextResponse } from 'next/server';
import { requireOpsCron } from '@/lib/auth/ops-cron';
import { reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const negado = await requireOpsCron(req);
  if (negado) return negado;
  try {
    return NextResponse.json(await reconciliarSwapsOrfaos());
  } catch (err) {
    console.error('[ops/reconciliar-subscricoes]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
