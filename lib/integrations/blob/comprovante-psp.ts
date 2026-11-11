/**
 * Espelho do comprovante do Pix de saída (E1-2) no Vercel Blob PRIVADO, SEM sobrescrever
 * (`allowOverwrite: false`): se o arquivo do dia já existe, o envio é tratado como feito. A fonte da verdade é
 * `TransferenciaPix.comprovante` (bytes hasheados e ancorados); o Blob guarda a cópia.
 */
import { put } from '@vercel/blob';

export class ComprovanteBlobError extends Error {
  constructor(readonly motivo: 'SEM_TOKEN' | 'FALHOU', options?: { cause?: unknown }) {
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
    // Já existe = gravado numa tentativa anterior (os bytes são determinísticos por cessão).
    if (/already exists/i.test((cause as { message?: string })?.message ?? '')) return { pathname };
    throw new ComprovanteBlobError('FALHOU', { cause });
  }
  return { pathname };
}
