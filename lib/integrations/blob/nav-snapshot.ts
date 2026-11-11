/**
 * Espelho do arquivo do snapshot do NAV (E3-1) no Vercel Blob. O store da Plina é PRIVADO: o arquivo sobe privado
 * e a URL pública é a rota `GET /api/nav-snapshot/<data>`, que serve os bytes de `SnapshotNav.conteudo` (fonte da
 * verdade, conferida contra o SHA-256); o Blob não é lido pela rota. Pathname determinístico por dia, sem sufixo aleatório: reenviar os MESMOS
 * bytes é idempotente (`allowOverwrite`). Fail-closed: sem token não há publicação.
 */
import { put } from '@vercel/blob';

export class PublicacaoSnapshotError extends Error {
  constructor(readonly motivo: 'SEM_TOKEN' | 'FALHOU', options?: { cause?: unknown }) {
    super('Publicação do snapshot indisponível; nada foi ancorado.', options);
    this.name = 'PublicacaoSnapshotError';
  }
}

export function snapshotNavPathname(data: string): string {
  return `nav-snapshots/${data}.json`;
}

/** URL pública estável do arquivo do dia (a rota abaixo serve o blob privado). */
export function snapshotNavUrlPublica(data: string): string {
  const base = (process.env.APP_BASE_URL ?? 'https://plina.finance').replace(/\/+$/, '');
  return `${base}/api/nav-snapshot/${data}`;
}

/** Sobe os bytes (privado) e devolve a URL pública. Os bytes são exatamente os que foram hasheados. */
export async function publicarArquivoSnapshot(input: {
  data: string;
  bytes: Buffer;
}): Promise<{ url: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new PublicacaoSnapshotError('SEM_TOKEN');
  try {
    await put(snapshotNavPathname(input.data), input.bytes, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: snapshotNavUrlPublica(input.data) };
  } catch (cause) {
    throw new PublicacaoSnapshotError('FALHOU', { cause });
  }
}
