/**
 * GET /api/nav-snapshot/[data] — arquivo PÚBLICO do snapshot diário do NAV (E3-1), `data` = YYYY-MM-DD (UTC).
 * É o arquivo cujo SHA-256 está no Memo.hash da âncora: devolve os bytes exatos, byte a byte. A fonte é o banco
 * (`conteudo`, os bytes hasheados e ancorados), conferido contra o SHA-256 gravado; o Blob é só espelho, então uma
 * queda ou sobrescrita do Blob não derruba a prova (F-E31-4). Só snapshots PUBLICADOS. Rate limit por IP. Sem PII.
 */
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
      select: { status: true, sha256: true, conteudo: true },
    });
    if (!row || row.status !== 'PUBLICADO') return naoEncontrado();
    const bytes = Buffer.from(row.conteudo, 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      console.error('[nav-snapshot] conteúdo gravado não confere com o hash');
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
