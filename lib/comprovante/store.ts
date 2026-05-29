/**
 * Armazenamento do comprovante PDF no Vercel Blob privado (PRD §M1 F-M1-8).
 *
 * Best-effort: sem `BLOB_READ_WRITE_TOKEN` (dev/test), vira no-op. O blob é
 * **privado** — o download é servido pela rota `/api/comprovante/[cessaoId]`,
 * que faz stream via `get(..., { access: 'private' })`. Guardamos só o
 * `pathname` em `Pagamento.comprovanteUrl`.
 */

import { put, get } from '@vercel/blob';

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function comprovantePathname(cessaoId: string): string {
  return `comprovantes/${cessaoId}.pdf`;
}

/** Sobe o PDF privado. Retorna o pathname guardável, ou `null` se desabilitado. */
export async function uploadComprovante(
  cessaoId: string,
  pdf: Buffer,
): Promise<string | null> {
  if (!blobEnabled()) return null;
  const pathname = comprovantePathname(cessaoId);
  await put(pathname, pdf, {
    access: 'private',
    contentType: 'application/pdf',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return pathname;
}

/** Stream do comprovante privado para servir no route handler. */
export async function getComprovanteStream(pathname: string) {
  return get(pathname, { access: 'private' });
}
