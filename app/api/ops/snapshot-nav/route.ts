/**
 * POST /api/ops/snapshot-nav — snapshot diário do NAV ancorado (E3-1), disparado pelo agendador do Farol.
 *
 * Contrato: contratos/2026-11-11-ops-5-e3-1-agendadores.md + 2026-11-11-e3-1-snapshot-nav.md.
 * `Authorization: Bearer <OPS_CRON_SECRET>`; sem ele a rota não existe (404). Idempotente por dia UTC.
 * 2xx só depois de gates, arquivo publicado, âncora confirmada e txHash persistido. Resposta: sem PII,
 * sem segredo, sem XDR e sem o corpo do arquivo (só a URL pública e os hashes).
 */
import { NextResponse } from 'next/server';
import { requireOpsCron } from '@/lib/auth/ops-cron';
import { SnapshotNavError, publicarSnapshotNav } from '@/lib/services/snapshot-nav';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const negado = await requireOpsCron(req);
  if (negado) return negado;
  try {
    const r = await publicarSnapshotNav();
    return NextResponse.json({
      publicado: true,
      // Dia anterior ainda sem concluir é incidente: o workflow falha o job.
      alerta: r.pendentes > 0,
      reutilizada: r.reutilizada,
      data: r.data,
      sha256: r.sha256,
      txHash: r.txHash,
      url: r.url,
      pendentes: r.pendentes,
    });
  } catch (err) {
    if (err instanceof SnapshotNavError) {
      console.error('[ops/snapshot-nav]', err.code, err.causa ?? '');
      if (err.code === 'EM_ANDAMENTO') {
        return NextResponse.json({ publicado: false, alerta: false, codigo: err.code }, { status: 409 });
      }
      return NextResponse.json({ publicado: false, alerta: true, codigo: err.code }, { status: 503 });
    }
    console.error('[ops/snapshot-nav]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ publicado: false, alerta: true, codigo: 'ERRO_INTERNO' }, { status: 500 });
  }
}
