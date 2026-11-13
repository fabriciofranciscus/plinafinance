/**
 * Guarda os BYTES do PDF assinado da cessão no Vercel Blob PRIVADO (DS3).
 *
 * O hash ancorado é o SHA-256 destes bytes: dois downloads do mesmo documento no
 * DocuSign não são idênticos byte a byte, então o PDF baixado é guardado UMA vez
 * e nunca baixado de novo para recalcular o hash. `allowOverwrite: false`: uma
 * 2ª gravação não substitui o que o hash já cobre.
 *
 * Diferente do comprovante, sem `BLOB_READ_WRITE_TOKEN` NÃO é no-op: falha
 * fechado (não se ancora hash de arquivo que não foi guardado).
 */

import { put, get } from '@vercel/blob';

export class ArmazenamentoIndisponivelError extends Error {
  readonly code = 'ARMAZENAMENTO_INDISPONIVEL' as const;
  constructor() {
    super('Armazenamento do documento assinado indisponível (Blob não configurado).');
    this.name = 'ArmazenamentoIndisponivelError';
  }
}

export function cessaoAssinadaPathname(cessaoId: string): string {
  return `cessoes/${cessaoId}/assinada.pdf`;
}

function exigirBlob(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ArmazenamentoIndisponivelError();
}

/** Lê os bytes guardados, ou `null` se ainda não há. Erro de leitura propaga. */
export async function lerCessaoAssinada(cessaoId: string): Promise<Buffer | null> {
  exigirBlob();
  const r = await get(cessaoAssinadaPathname(cessaoId), { access: 'private' });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

/** Guarda os bytes (sem sobrescrever). Devolve o pathname. */
export async function guardarCessaoAssinada(cessaoId: string, pdf: Buffer): Promise<string> {
  exigirBlob();
  const pathname = cessaoAssinadaPathname(cessaoId);
  await put(pathname, pdf, {
    access: 'private',
    contentType: 'application/pdf',
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return pathname;
}
