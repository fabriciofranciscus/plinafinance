#!/usr/bin/env node
/**
 * Baixa as fontes ITF (Chillax e Satoshi) de um Vercel Blob PRIVADO para
 * `public/fonts/itf/` (pasta ignorada pelo git).
 *
 * Por quê: a licença ITF FFL 2.0 permite servir as fontes pelo site, mas
 * proíbe redistribuí-las em repositório público. Os arquivos ficam num Blob
 * privado e entram só na build.
 *
 * Garantias:
 *  - NUNCA falha a build. Sem token, sem rede, com hash errado ou com erro do
 *    Blob, sai com código 0, avisa no log e a landing cai para Geist.
 *  - Tudo ou nada: só grava os 4 arquivos se os 4 baixaram e batem com o
 *    SHA-256 e o tamanho do manifesto (scripts/build/itf-fonts.manifest.json).
 *    Um Blob adulterado ou corrompido nunca chega ao site.
 *  - Não imprime o token nem o texto cru de erros.
 *  - Se os 4 arquivos já existem (cópia local), não baixa nada.
 *
 * Ambiente (só na build; a Vercel não distingue build de runtime, mas o app
 * não lê esta variável):
 *  - ITF_FONTS_BLOB_TOKEN (ou ITF_FONTS_READ_WRITE_TOKEN, criado pelo painel com o
 *    prefixo ITF_FONTS): token do store `plina-itf-fonts`, só de fontes; nunca
 *    reutilizar o BLOB_READ_WRITE_TOKEN do app.
 *
 * Linha final no log da build:  `[itf-fonts] OK 4/4` (ou `AVISO ... Geist`).
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_URL = new URL('./itf-fonts.manifest.json', import.meta.url);
const TIMEOUT_MS = 20_000;

export function loadManifest(url = MANIFEST_URL) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Download padrão: SDK oficial do Vercel Blob, acesso privado. */
export async function downloadFromBlob(pathname, token, signal) {
  const { get } = await import('@vercel/blob');
  const res = await get(pathname, { access: 'private', token, abortSignal: signal });
  if (!res || res.statusCode !== 200 || !res.stream) {
    throw new Error('blob_not_found');
  }
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

function reason(err) {
  const msg = err instanceof Error ? err.message : String(err);
  // Só o motivo curto; sem URL, sem cabeçalhos, sem token.
  return msg.replace(/https?:\/\/\S+/g, '<url>').slice(0, 120);
}

/**
 * @returns {Promise<{status: 'present'|'downloaded'|'skipped'|'failed', ok: number, total: number}>}
 */
export async function run({
  dir,
  env = process.env,
  manifest = loadManifest(),
  download = downloadFromBlob,
  log = console.log,
  warn = console.warn,
} = {}) {
  const total = manifest.files.length;
  const present = manifest.files.filter((f) => existsSync(join(dir, f.name)));

  if (present.length === total) {
    for (const f of manifest.files) {
      if (sha256(readFileSync(join(dir, f.name))) !== f.sha256) {
        warn(`[itf-fonts] AVISO: ${f.name} local difere do manifesto (mantido).`);
      }
    }
    log(`[itf-fonts] OK ${total}/${total} (arquivos já presentes, nada baixado)`);
    return { status: 'present', ok: total, total };
  }

  // Nome canônico: ITF_FONTS_BLOB_TOKEN. O painel da Vercel, ao conectar o store com o
  // prefixo "ITF_FONTS", cria ITF_FONTS_READ_WRITE_TOKEN; aceitamos os dois.
  const token = (env.ITF_FONTS_BLOB_TOKEN || env.ITF_FONTS_READ_WRITE_TOKEN || '').trim();
  if (!token) {
    warn(
      `[itf-fonts] AVISO: ITF_FONTS_BLOB_TOKEN ausente; a build segue com Geist (${present.length}/${total} arquivos locais).`,
    );
    return { status: 'skipped', ok: present.length, total };
  }

  try {
    const buffers = [];
    for (const f of manifest.files) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      let buf;
      try {
        buf = await download(`${manifest.prefix}${f.name}`, token, ctl.signal);
      } finally {
        clearTimeout(timer);
      }
      if (buf.length !== f.bytes || sha256(buf) !== f.sha256) {
        throw new Error(`hash_or_size_mismatch:${f.name}`);
      }
      buffers.push([f.name, buf]);
    }

    mkdirSync(dir, { recursive: true });
    for (const [name, buf] of buffers) {
      const tmp = join(dir, `${name}.tmp`);
      writeFileSync(tmp, buf);
      renameSync(tmp, join(dir, name));
    }
    log(`[itf-fonts] OK ${total}/${total} (baixados do Blob privado, SHA-256 conferido)`);
    return { status: 'downloaded', ok: total, total };
  } catch (err) {
    for (const f of manifest.files) rmSync(join(dir, `${f.name}.tmp`), { force: true });
    warn(`[itf-fonts] AVISO: download falhou (${reason(err)}); a build segue com Geist.`);
    return { status: 'failed', ok: present.length, total };
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    await run({ dir: join(process.cwd(), 'public', 'fonts', 'itf') });
  } catch (err) {
    console.warn(`[itf-fonts] AVISO: erro inesperado (${reason(err)}); a build segue com Geist.`);
  }
  process.exit(0);
}
