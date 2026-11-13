/**
 * Espelho do comprovante do Pix de saída (E1-2) no Vercel Blob PRIVADO, SEM sobrescrever
 * (`allowOverwrite: false`): se o arquivo já existe, só vale se o SHA-256 for o mesmo; outro conteúdo = erro `DIVERGE`. A fonte da verdade é
 * `TransferenciaPix.comprovante` (bytes hasheados e ancorados); o Blob guarda a cópia.
 */
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';

export class ComprovanteBlobError extends Error {
  constructor(readonly motivo: 'SEM_TOKEN' | 'FALHOU' | 'DIVERGE', options?: { cause?: unknown }) {
    super('Comprovante do Pix não pôde ser guardado; nada foi ancorado.', options);
    this.name = 'ComprovanteBlobError';
  }
}

export function comprovantePspPathname(cessaoId: string): string {
  return `comprovantes-psp/${cessaoId}.json`;
}

export async function guardarComprovantePsp(input: { cessaoId: string; bytes: Buffer }): Promise<{ pathname: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ComprovanteBlobError('SEM_TOKEN');
  const pathname = comprovantePspPathname(input.cessaoId);
  try {
    await put(pathname, input.bytes, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch (cause) {
    if (!/already exists/i.test((cause as { message?: string })?.message ?? '')) {
      throw new ComprovanteBlobError('FALHOU', { cause });
    }
    // Já existe: só vale se for EXATAMENTE este comprovante (SHA-256); outro arquivo no mesmo caminho é divergência.
    try {
      const atual = await get(pathname, { access: 'private' });
      if (!atual || atual.statusCode !== 200) throw new Error('ilegível');
      const existente = Buffer.from(await new Response(atual.stream).arrayBuffer());
      if (createHash('sha256').update(existente).digest('hex') !== createHash('sha256').update(input.bytes).digest('hex')) {
        throw new ComprovanteBlobError('DIVERGE');
      }
    } catch (err) {
      if (err instanceof ComprovanteBlobError) throw err;
      throw new ComprovanteBlobError('FALHOU', { cause: err });
    }
  }
  return { pathname };
}
