/**
 * GET /api/comprovante/[cessaoId] — download do comprovante PDF (PRD §M1 F-M1-8).
 *
 * Link durável: o blob é privado e este handler faz stream via
 * `get(..., { access: 'private' })`, mintando o acesso server-side a cada
 * clique. O `cessaoId` é o token de acesso (mesmo padrão de /cessao/[id]).
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getComprovanteStream } from '@/lib/comprovante/store';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cessaoId: string }> },
) {
  const { cessaoId } = await params;

  const pagamento = await db.pagamento.findUnique({
    where: { cessaoId },
    select: { comprovanteUrl: true },
  });
  if (!pagamento?.comprovanteUrl) {
    return NextResponse.json(
      { error: 'comprovante indisponível' },
      { status: 404 },
    );
  }

  try {
    const res = await getComprovanteStream(pagamento.comprovanteUrl);
    if (!res || res.statusCode !== 200) {
      return NextResponse.json(
        { error: 'comprovante indisponível' },
        { status: 404 },
      );
    }
    return new Response(res.stream, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="comprovante-${cessaoId}.pdf"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'comprovante indisponível' },
      { status: 404 },
    );
  }
}
