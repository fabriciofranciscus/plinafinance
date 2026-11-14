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
import { obterPrecoReferenciaTesouro } from '@/lib/services/preco-referencia-tesouro';
import {
  marcarConflitosAlertados,
  marcarConflitosResgateAlertados,
  reconciliarSwapsOrfaos,
} from '@/lib/services/swap-escrituracao';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const negado = await requireOpsCron(req);
  if (negado) return negado;
  try {
    const { conflitoQuoteIds, conflitoResgateIds, ...contagens } = await reconciliarSwapsOrfaos();
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
      // A marca de dedupe só vale se o e-mail FOI entregue; senão a próxima varredura alerta de novo.
      if (alertaEnviado) {
        try {
          await marcarConflitosAlertados(conflitoQuoteIds);
        } catch (err) {
          console.error('[ops/reconciliar-subscricoes] marca do alerta falhou', (err as { name?: string })?.name ?? 'erro');
        }
      }
    }
    // Resgate (E2-6): mesma regra — tx liberada por tempo entrou com a cotação já consumida por outra tx.
    let alertaResgateEnviado = false;
    if (conflitoResgateIds.length > 0) {
      alertaResgateEnviado = await enviarAlertaOps({
        assunto: 'resgate liberado por tempo entrou na chain com a cotação já consumida (possível pagamento duplo)',
        linhas: [
          'A vigia de 24 h achou uma tx de resgate, liberada por tempo, que entrou on-chain com sucesso enquanto a',
          'cotação já foi consumida por OUTRA tx. NÃO foi escriturada. O operador/Atlas decide (runbook).',
          '',
          ...conflitoResgateIds.map((id) => `cotação de resgate: ${id}`),
        ],
      });
      if (alertaResgateEnviado) {
        try {
          await marcarConflitosResgateAlertados(conflitoResgateIds);
        } catch (err) {
          console.error('[ops/reconciliar-subscricoes] marca do alerta do resgate falhou', (err as { name?: string })?.name ?? 'erro');
        }
      }
    }
    // Referência de preço do TESOURO (F7): vencida (> 30 dias) ou ausente = todo resgate é recusado até a operação
    // atualizar PRECO_TESOURO_REF_BRL/DATA. Só o estado na resposta (sem valores).
    let referenciaPreco: string;
    try {
      referenciaPreco = (await obterPrecoReferenciaTesouro()).status;
    } catch (err) {
      console.error('[ops/reconciliar-subscricoes] referência de preço', (err as { name?: string })?.name ?? 'erro');
      referenciaPreco = 'INDISPONIVEL';
    }
    // `alerta` = há conflito em aberto (sem alerta entregue ainda) OU resgate órfão sem prova: fica true a cada varredura até resolver.
    // O workflow agendado deve falhar o job quando for true.
    return NextResponse.json({
      ...contagens,
      referenciaPreco,
      // Órfã (resgate ou swap) SEM prova (INDETERMINADO / sem XDR) fecha o NAV e não se resolve sozinha: o job tem de falhar.
      alerta:
        contagens.vigiaConflitos > 0 ||
        contagens.resgatesVigiaConflitos > 0 ||
        contagens.resgatesSemProva > 0 ||
        contagens.vencidasSemProva > 0 ||
        referenciaPreco !== 'OK',
      alertaEnviado: alertaEnviado || alertaResgateEnviado,
    });
  } catch (err) {
    console.error('[ops/reconciliar-subscricoes]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
