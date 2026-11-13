/**
 * GET /api/ops/pix-saida — varredor do Pix de saída ao cedente (E1-2), disparado por agendador com
 * `Authorization: Bearer <OPS_CRON_SECRET>`; 404 sem ele. Retoma transferências sem reenviar, fecha as comprovadas e
 * levanta alerta (VALOR_DIVERGE, INCERTO, PROCESSANDO > 30 min). Resposta: SÓ contagens, sem PII, sem ids. O e-mail
 * de alerta leva ids internos de cessão e só marca "avisado" depois de entregue (como o varredor do swap).
 * Contrato: contratos/2026-11-12-e1-2-fiacao-pagamento-cedente.md.
 */
import { NextResponse } from 'next/server';
import { requireOpsCron } from '@/lib/auth/ops-cron';
import { enviarAlertaOps } from '@/lib/services/alerta-ops';
import { marcarPixAvisados, varrerPixSaida } from '@/lib/services/pix-saida-varredor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const negado = await requireOpsCron(req);
  if (negado) return negado;
  try {
    const { paraAvisar, ...contagens } = await varrerPixSaida();
    let alertaEnviado = false;
    if (paraAvisar.length > 0) {
      alertaEnviado = await enviarAlertaOps({
        assunto: 'Pix de saída ao cedente precisa de atenção (valor divergente, incerto ou parado há mais de 30 min)',
        linhas: [
          'Há pagamento(s) ao cedente em estado que exige conferência do operador. Nada é reenviado automaticamente.',
          '',
          ...paraAvisar.map((id) => `cessão: ${id}`),
        ],
      });
      if (alertaEnviado) {
        try {
          await marcarPixAvisados(paraAvisar);
        } catch (err) {
          console.error('[ops/pix-saida] marca do alerta falhou', (err as { name?: string })?.name ?? 'erro');
        }
      }
    }
    return NextResponse.json({ ...contagens, alertaEnviado });
  } catch (err) {
    console.error('[ops/pix-saida]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
