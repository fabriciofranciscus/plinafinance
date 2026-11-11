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
import { enviarAlertaOps } from '@/lib/services/alerta-ops';
import { reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const negado = await requireOpsCron(req);
  if (negado) return negado;
  try {
    const { conflitoQuoteIds, ...contagens } = await reconciliarSwapsOrfaos();
    // Alarme imediato (mesmo canal do alarme de emissão: e-mail da caixa de incidentes): conflito NOVO da vigia
    // de 24 h = emissão dupla. Um e-mail por quote (dedupe no reconciliador). O corpo leva só ids internos.
    let alertaEnviado = false;
    if (conflitoQuoteIds.length > 0) {
      alertaEnviado = await enviarAlertaOps({
        assunto: 'swap liberado por tempo entrou na chain com o quote já consumido (possível emissão dupla)',
        linhas: [
          'A vigia de 24 h achou uma tx de swap, liberada por tempo, que entrou on-chain com sucesso enquanto o quote',
          'já foi consumido por OUTRA tx. NÃO foi escriturada. O operador/Atlas decide (runbook).',
          '',
          ...conflitoQuoteIds.map((id) => `quote: ${id}`),
        ],
      });
    }
    // `alerta` também fica na resposta: o workflow agendado deve falhar o job quando for true.
    return NextResponse.json({ ...contagens, alerta: contagens.vigiaConflitos > 0, alertaEnviado });
  } catch (err) {
    console.error('[ops/reconciliar-subscricoes]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
