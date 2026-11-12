import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as mod from '../../scripts/build/fetch-itf-fonts.mjs';

const run = (mod as unknown as {
  run: (o: Record<string, unknown>) => Promise<{ status: string }>;
}).run;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const CONTENT: Record<string, Buffer> = {
  'A.woff2': Buffer.from('aaaa'),
  'B.woff2': Buffer.from('bbbbbb'),
};
const manifest = {
  prefix: 'itf/',
  files: Object.entries(CONTENT).map(([name, b]) => ({ name, sha256: sha(b), bytes: b.length })),
};

let dir: string;
let logs: string[];
let warns: string[];
const io = () => ({ log: (m: string) => logs.push(m), warn: (m: string) => warns.push(m) });
const okDownload = async (p: string) => CONTENT[p.replace('itf/', '')];

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'itf-')), 'fonts');
  logs = [];
  warns = [];
});
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

describe('fetch-itf-fonts (LV2)', () => {
  it('sem token: não baixa, não falha, avisa e deixa a pasta vazia (Geist)', async () => {
    let calls = 0;
    const r = await run({
      dir, env: {}, manifest, ...io(),
      download: async () => { calls++; return Buffer.alloc(0); },
    });
    expect(r.status).toBe('skipped');
    expect(calls).toBe(0);
    expect(existsSync(dir)).toBe(false);
    expect(warns.join(' ')).toContain('Geist');
  });

  it('token em branco conta como ausente', async () => {
    const r = await run({ dir, env: { ITF_FONTS_BLOB_TOKEN: '   ' }, manifest, ...io(), download: okDownload });
    expect(r.status).toBe('skipped');
  });

  it('com token: baixa os arquivos do prefixo itf/ e confere o hash', async () => {
    const seen: string[] = [];
    const r = await run({
      dir, env: { ITF_FONTS_BLOB_TOKEN: 'tok' }, manifest, ...io(),
      download: async (p: string, t: string) => { seen.push(p); expect(t).toBe('tok'); return okDownload(p); },
    });
    expect(r.status).toBe('downloaded');
    expect(seen).toEqual(['itf/A.woff2', 'itf/B.woff2']);
    expect(readFileSync(join(dir, 'A.woff2'))).toEqual(CONTENT['A.woff2']);
    expect(logs.join(' ')).toContain('OK 2/2');
  });

  it('hash divergente: tudo ou nada, nada é gravado, build segue em Geist', async () => {
    const r = await run({
      dir, env: { ITF_FONTS_BLOB_TOKEN: 'tok' }, manifest, ...io(),
      download: async (p: string) => (p.endsWith('B.woff2') ? Buffer.from('adulterado') : CONTENT['A.woff2']),
    });
    expect(r.status).toBe('failed');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect(warns.join(' ')).toContain('Geist');
  });

  it('erro do Blob (403/rede): não lança, não vaza o token nem a URL', async () => {
    const r = await run({
      dir, env: { ITF_FONTS_BLOB_TOKEN: 'segredo-123' }, manifest, ...io(),
      download: async () => { throw new Error('403 https://x.private.blob.vercel-storage.com/itf/A.woff2?token=segredo-123'); },
    });
    expect(r.status).toBe('failed');
    const out = [...logs, ...warns].join(' ');
    expect(out).not.toContain('segredo-123');
    expect(out).not.toContain('https://');
  });

  it('arquivos já presentes: não baixa mesmo com token', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    for (const [n, b] of Object.entries(CONTENT)) writeFileSync(join(dir, n), b);
    let calls = 0;
    const r = await run({
      dir, env: { ITF_FONTS_BLOB_TOKEN: 'tok' }, manifest, ...io(),
      download: async () => { calls++; return Buffer.alloc(0); },
    });
    expect(r.status).toBe('present');
    expect(calls).toBe(0);
  });

  it('o manifesto real lista os 4 arquivos esperados por components/ItfFontFaces', () => {
    const real = JSON.parse(readFileSync('scripts/build/itf-fonts.manifest.json', 'utf8'));
    expect(real.files.map((f: { name: string }) => f.name).sort()).toEqual([
      'Chillax-Medium.woff2', 'Chillax-Semibold.woff2', 'Satoshi-Light.woff2', 'Satoshi-Regular.woff2',
    ]);
    for (const f of real.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
