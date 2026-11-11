/**
 * GET /api/nav-snapshot/[data] — arquivo PÚBLICO do snapshot diário do NAV (E3-1), `data` = YYYY-MM-DD (UTC).
 * É o arquivo cujo SHA-256 está no Memo.hash da âncora: devolve os bytes exatos, byte a byte, e só se o SHA-256
 * do blob confere com o do banco (nunca serve arquivo que não bate com o que foi ancorado). Só snapshots
 * PUBLICADOS. Rate limit por IP. Sem PII (o arquivo não tem).
 */
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { lerArquivoSnapshot } from '@/lib/integrations/blob/nav-snapshot';
import { clientIp, publicLimiter } from '@/lib/rate-limit/config';

export const dynamic = 'force-dynamic';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const naoEncontrado = () => NextResponse.json({ error: 'not found' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ data: string }> }) {
  if (!(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const { data } = await params;
  if (!DATA.test(data)) return naoEncontrado();
  try {
    const row = await db.snapshotNav.findUnique({
      where: { data },
      select: { status: true, sha256: true },
    });
    if (!row || row.status !== 'PUBLICADO') return naoEncontrado();
    const bytes = await lerArquivoSnapshot(data);
    if (!bytes) return naoEncontrado();
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      console.error('[nav-snapshot] blob não confere com o hash gravado');
      return NextResponse.json({ error: 'indisponível' }, { status: 503 });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[nav-snapshot]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'indisponível' }, { status: 503 });
  }
}
