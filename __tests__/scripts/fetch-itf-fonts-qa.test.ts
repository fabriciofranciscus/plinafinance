// QA (Vera, LV4): scripts/build/fetch-itf-fonts.mjs — nunca falha a build, tudo-ou-nada, sem vazar token/URL, sem fonte no git.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { run, loadManifest } from '../../scripts/build/fetch-itf-fonts.mjs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const TOKEN = 'vercel_blob_rw_SEGREDO123456789_abcdefghijklmnop';
let dir: string;
let warns: string[];
let logs: string[];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'itf-')); warns = []; logs = []; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

/** Manifesto sintético de 4 arquivos com conteúdo conhecido. */
function manifestoDe(conteudos: Record<string, Buffer>) {
  return { prefix: 'itf/', files: Object.entries(conteudos).map(([name, b]) => ({ name, sha256: sha(b), bytes: b.length })) };
}
const CONT = { 'A.woff2': Buffer.from('aaaa'), 'B.woff2': Buffer.from('bbbbbb'), 'C.woff2': Buffer.from('cc'), 'D.woff2': Buffer.from('dddddddd') };
const M = manifestoDe(CONT);
const opcoes = (over: Record<string, unknown> = {}) => ({ dir, env: { ITF_FONTS_BLOB_TOKEN: TOKEN } as never, manifest: M, log: (s: string) => logs.push(s), warn: (s: string) => warns.push(s), ...over });
const baixaOk = (calls?: string[]) => async (p: string) => { calls?.push(p); return CONT[p.replace('itf/', '') as keyof typeof CONT]; };
const arquivos = () => readdirSync(dir).sort();

describe('fetch-itf-fonts: download', () => {
  it('4/4 conferem (SHA-256 e tamanho) → grava os 4, sem .tmp sobrando, usa o prefixo do manifesto e o token informado', async () => {
    const calls: string[] = []; let tokenUsado = '';
    const r = await run(opcoes({ download: async (p: string, t: string) => { tokenUsado = t; return baixaOk(calls)(p); } }));
    expect(r).toEqual({ status: 'downloaded', ok: 4, total: 4 });
    expect(arquivos()).toEqual(['A.woff2', 'B.woff2', 'C.woff2', 'D.woff2']);
    expect(calls).toEqual(['itf/A.woff2', 'itf/B.woff2', 'itf/C.woff2', 'itf/D.woff2']);
    expect(tokenUsado).toBe(TOKEN);
    expect(logs.join('\n')).toMatch(/OK 4\/4.*SHA-256/);
    for (const [n, b] of Object.entries(CONT)) expect(readFileSync(join(dir, n)).equals(b)).toBe(true);
  });

  it('TUDO OU NADA: o 3º arquivo com hash errado (conteúdo adulterado do mesmo tamanho) → nenhum arquivo é gravado, status failed, aviso Geist', async () => {
    const r = await run(opcoes({ download: async (p: string) => (p.endsWith('C.woff2') ? Buffer.from('XX') : CONT[p.replace('itf/', '') as keyof typeof CONT]) }));
    expect(r.status).toBe('failed');
    expect(arquivos()).toEqual([]);
    expect(warns.join('\n')).toMatch(/hash_or_size_mismatch:C\.woff2.*Geist/);
  });

  it('tamanho diferente com o mesmo prefixo de conteúdo → reprova; arquivo vazio (0 bytes) reprova; nada gravado', async () => {
    for (const ruim of [Buffer.concat([CONT['B.woff2'], Buffer.from('x')]), Buffer.alloc(0)]) {
      warns.length = 0;
      const r = await run(opcoes({ download: async (p: string) => (p.endsWith('B.woff2') ? ruim : CONT[p.replace('itf/', '') as keyof typeof CONT]) }));
      expect(r.status).toBe('failed');
      expect(arquivos()).toEqual([]);
    }
  });

  it('erro do Blob com URL no texto (4º arquivo): o aviso NÃO repete a URL nem o host; é curto; nada gravado; build não lança', async () => {
    const r = await run(opcoes({ download: async (p: string) => { if (p.endsWith('D.woff2')) throw new Error(`fetch https://abc.private.blob.vercel-storage.com/itf/D.woff2?x=1 falhou`); return CONT[p.replace('itf/', '') as keyof typeof CONT]; } }));
    expect(r.status).toBe('failed');
    const w = warns.join('\n');
    expect(w).not.toContain('blob.vercel-storage.com');
    expect(w).toContain('<url>');
    expect(w.length).toBeLessThan(400);
    expect(arquivos()).toEqual([]);
  });

  // F-LV4-1 (FECHADO em 127787b): reason(err, token) troca o token exato por <token> e o padrão vercel_blob_rw_… por <token>
  // ANTES de cortar em 120 caracteres.
  const erroCom = (msg: string) => async (p: string) => { if (p.endsWith('D.woff2')) throw new Error(msg); return CONT[p.replace('itf/', '') as keyof typeof CONT]; };
  const avisoDe = async (msg: string, env: Record<string, string> = { ITF_FONTS_BLOB_TOKEN: TOKEN }) => { warns.length = 0; await run(opcoes({ env, download: erroCom(msg) })); return warns.join('\n'); };

  it('F-LV4-1 — o token FORA de URL (Authorization: Bearer …, token=…, JSON, aspas, várias vezes) nunca aparece no aviso; vira <token>', async () => {
    for (const msg of [
      `Authorization: Bearer ${TOKEN} rejeitado`,
      `token=${TOKEN}&x=1 inválido`,
      `{"error":"bad token","token":"${TOKEN}"}`,
      `'${TOKEN}' e "${TOKEN}" e ${TOKEN}`,
      `${TOKEN}`,
    ]) {
      const w = await avisoDe(msg);
      expect(w).not.toContain(TOKEN);
      expect(w).not.toContain('SEGREDO');
      expect(w).toContain('<token>');
    }
  });

  it('F-LV4-1 — o corte em 120 caracteres vem DEPOIS da redação: o token na fronteira do corte não deixa pedaço (prefixo longo de 100/110/115/119 caracteres)', async () => {
    for (const n of [100, 110, 115, 119, 120, 121]) {
      const w = await avisoDe(`${'x'.repeat(n)}${TOKEN} fim`);
      expect(w).not.toMatch(/vercel_blob_rw/);
      expect(w).not.toContain('SEGREDO');
    }
  });

  it('F-LV4-1 — o padrão vercel_blob_rw_… é redigido mesmo quando é de OUTRO token (≠ o recebido): store, copia antiga ou de outro ambiente', async () => {
    const outro = 'vercel_blob_rw_OUTROSTORE_ZZZtokenALHEIO987654321';
    const w = await avisoDe(`conflito com ${outro} e com ${TOKEN}`);
    expect(w).not.toContain('OUTROSTORE');
    expect(w).not.toContain('ALHEIO');
    expect(w).not.toContain('SEGREDO');
  });

  it('F-LV4-1 — o token recebido é redigido mesmo quando NÃO segue o padrão vercel_blob_rw_ (nome do painel/ formato futuro, com hífen e ponto)', async () => {
    const estranho = 'tok-ABC.def_123-XYZ';
    const w = await avisoDe(`falhou com ${estranho} agora`, { ITF_FONTS_BLOB_TOKEN: estranho });
    expect(w).not.toContain(estranho);
    expect(w).toContain('<token>');
  });

  it('F-LV4-1 — token com caracteres especiais de regex (. * + ? ( ) [ ] $ ^ \\) é redigido literalmente (split/join, não RegExp)', async () => {
    const t = 'a.b*c+d?(e)[f]$g^h\\i';
    const w = await avisoDe(`erro ${t} fim ${t}`, { ITF_FONTS_BLOB_TOKEN: t });
    expect(w).not.toContain(t);
    expect(w.match(/<token>/g)).toHaveLength(2);
  });

  it('F-LV4-1 — o mesmo vale com o token vindo de ITF_FONTS_READ_WRITE_TOKEN (nome do painel) e quando o erro não é um Error (string/objeto)', async () => {
    const t = 'vercel_blob_rw_PAINEL_abcdef123456';
    expect(await avisoDe(`x ${t} y`, { ITF_FONTS_READ_WRITE_TOKEN: t })).not.toContain('PAINEL');
    warns.length = 0;
    await run(opcoes({ env: { ITF_FONTS_BLOB_TOKEN: TOKEN } as never, download: async (p: string) => { if (p.endsWith('B.woff2')) throw `texto solto com ${TOKEN}`; return CONT[p.replace('itf/', '') as keyof typeof CONT]; } }));
    expect(warns.join('\n')).not.toContain('SEGREDO');
  });

  it('F-LV4-1 — o aviso continua útil: o motivo curto e o "segue com Geist" ficam; token e URL juntos na mesma mensagem somem os dois', async () => {
    const w = await avisoDe(`503 em https://x.blob.vercel-storage.com/itf/D.woff2?t=${TOKEN} com ${TOKEN}`);
    expect(w).toMatch(/AVISO: download falhou \(503 em <url>/);
    expect(w).toMatch(/a build segue com Geist/);
    expect(w).not.toContain(TOKEN);
  });

  // Limite (info): o aviso cobre o token do store de fontes. Se o erro trouxesse OUTRO segredo (ex.: BLOB_READ_WRITE_TOKEN do app,
  // que o script nunca lê) em formato diferente de vercel_blob_rw_, ele não seria reconhecido: o cabeçalho do script limita-se a "token".
  it('LIMITE (info) — um segredo de OUTRA natureza no texto do erro não é redigido (a redação é do token recebido e do padrão vercel_blob_rw_)', async () => {
    const w = await avisoDe('falha: chave=sk_live_naoRedigido123');
    expect(w).toContain('sk_live_naoRedigido123');
  });

  // F-LV12-1 (INFO, pré-existente): se o erro do download tiver `message` NÃO textual, `reason()` lança TypeError DENTRO do catch de
  // run(), então run() rejeita em vez de devolver `failed`. A build segue segura porque a CLI (main) captura qualquer erro e sai 0,
  // mas o cabeçalho promete "nunca falha": coagir com String(err.message) fecharia o caso.
  it.fails('F-LV12-1 (INFO) — erro com message não textual: run() deve devolver failed (nunca lançar)', async () => {
    const e = Object.assign(new Error('x'), { message: 12345 as unknown as string });
    const r = await run(opcoes({ download: async () => { throw e; } }));
    expect(r.status).toBe('failed');
  });

  it('token DENTRO de URL no texto do erro: a URL inteira (com o token na query) é trocada por <url>, então o token não vaza por esse caminho', async () => {
    await run(opcoes({ download: async (p: string) => { if (p.endsWith('D.woff2')) throw new Error(`fetch https://x.blob.vercel-storage.com/itf/D.woff2?token=${TOKEN} falhou`); return CONT[p.replace('itf/', '') as keyof typeof CONT]; } }));
    expect(warns.join('\n')).not.toContain(TOKEN);
  });

  it('blob inexistente (null/undefined) e exceção qualquer → failed sem lançar', async () => {
    for (const d of [async () => { throw new Error('blob_not_found'); }, async () => { throw 'string solta'; }, async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }]) {
      await expect(run(opcoes({ download: d }))).resolves.toMatchObject({ status: 'failed' });
    }
    expect(arquivos()).toEqual([]);
  });

  it('timeout: o sinal de abort é passado e, ao abortar, o download pendurado vira failed (não pendura a build)', async () => {
    vi.useFakeTimers();
    let sinal: AbortSignal | undefined;
    const p = run(opcoes({ download: (_n: string, _t: string, s: AbortSignal) => { sinal = s; return new Promise((_, rej) => s.addEventListener('abort', () => rej(new Error('aborted')))); } }));
    await vi.advanceTimersByTimeAsync(20_001);
    const r = await p;
    expect(sinal?.aborted).toBe(true);
    expect(r.status).toBe('failed');
  });
});

describe('fetch-itf-fonts: token e arquivos locais', () => {
  it('sem token / token vazio / só espaços → skipped, NENHUM download, aviso Geist; códigos de saída da CLI = 0', async () => {
    for (const env of [{}, { ITF_FONTS_BLOB_TOKEN: '' }, { ITF_FONTS_BLOB_TOKEN: '   ' }, { ITF_FONTS_READ_WRITE_TOKEN: '\n' }]) {
      const dl = vi.fn(); warns.length = 0;
      const r = await run(opcoes({ env, download: dl }));
      expect(r.status).toBe('skipped'); expect(dl).not.toHaveBeenCalled(); expect(warns.join('')).toMatch(/ausente.*Geist/);
    }
  });

  it('token: ITF_FONTS_BLOB_TOKEN tem prioridade; ITF_FONTS_READ_WRITE_TOKEN (nome do painel) também vale; BLOB_READ_WRITE_TOKEN do app NUNCA é usado', async () => {
    const usados: string[] = [];
    const dl = async (p: string, t: string) => { usados.push(t); return baixaOk()(p); };
    await run(opcoes({ env: { ITF_FONTS_BLOB_TOKEN: 'canonico', ITF_FONTS_READ_WRITE_TOKEN: 'painel' }, download: dl })); rmSync(dir, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), 'itf-'));
    await run(opcoes({ env: { ITF_FONTS_READ_WRITE_TOKEN: 'painel' }, download: dl })); rmSync(dir, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), 'itf-'));
    const dl2 = vi.fn();
    const r = await run(opcoes({ env: { BLOB_READ_WRITE_TOKEN: 'do-app' }, download: dl2 }));
    expect(new Set(usados)).toEqual(new Set(['canonico', 'painel']));
    expect(usados.slice(0, 4).every((t) => t === 'canonico')).toBe(true);
    expect(r.status).toBe('skipped'); expect(dl2).not.toHaveBeenCalled();
  });

  it('4 arquivos já presentes → não baixa nada, nunca sobrescreve; arquivo local com hash diferente só gera AVISO (mantido)', async () => {
    for (const [n, b] of Object.entries(CONT)) writeFileSync(join(dir, n), n === 'B.woff2' ? Buffer.from('local-diferente') : b);
    const dl = vi.fn();
    const r = await run(opcoes({ download: dl }));
    expect(r).toEqual({ status: 'present', ok: 4, total: 4 });
    expect(dl).not.toHaveBeenCalled();
    expect(warns.join('\n')).toMatch(/B\.woff2 local difere/);
    expect(readFileSync(join(dir, 'B.woff2')).toString()).toBe('local-diferente');
  });

  it('2 de 4 presentes → baixa os 4 e confere todos; falha no meio não apaga os 2 que já existiam', async () => {
    writeFileSync(join(dir, 'A.woff2'), CONT['A.woff2']); writeFileSync(join(dir, 'B.woff2'), CONT['B.woff2']);
    await run(opcoes({ download: async (p: string) => { if (p.endsWith('D.woff2')) throw new Error('503'); return CONT[p.replace('itf/', '') as keyof typeof CONT]; } }));
    expect(arquivos()).toEqual(['A.woff2', 'B.woff2']);
  });
});

describe('fetch-itf-fonts: manifesto, CLI e repositório', () => {
  it('manifesto real: 4 arquivos .woff2, nomes seguros (sem caminho), SHA-256 de 64 hex, tamanho > 0, sem duplicata, prefixo itf/', () => {
    const m = loadManifest();
    expect(m.files).toHaveLength(4);
    expect(new Set(m.files.map((f: { name: string }) => f.name)).size).toBe(4);
    for (const f of m.files) { expect(f.name).toMatch(/^[A-Za-z0-9-]+\.woff2$/); expect(f.sha256).toMatch(/^[0-9a-f]{64}$/); expect(f.bytes).toBeGreaterThan(0); }
    expect(m.prefix).toBe('itf/');
  });

  it('CLI sem token, em diretório vazio: sai com código 0, avisa Geist e NÃO cria public/fonts/itf com arquivos', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'itfcli-'));
    try {
      const env = { ...process.env }; delete env.ITF_FONTS_BLOB_TOKEN; delete env.ITF_FONTS_READ_WRITE_TOKEN;
      const r = spawnSync(process.execPath, [resolve('scripts/build/fetch-itf-fonts.mjs')], { cwd, env, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stderr + r.stdout).toMatch(/AVISO.*Geist/);
      expect(existsSync(join(cwd, 'public', 'fonts', 'itf'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('CLI com token inválido e sem rede utilizável: ainda sai com 0 (a build nunca falha por causa das fontes) e não imprime o token', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'itfcli-'));
    try {
      const env = { ...process.env, ITF_FONTS_BLOB_TOKEN: TOKEN, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NO_PROXY: '' };
      const r = spawnSync(process.execPath, [resolve('scripts/build/fetch-itf-fonts.mjs')], { cwd, env, encoding: 'utf8', timeout: 120_000 });
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
      expect(readdirSync(join(cwd)).includes('public') ? readdirSync(join(cwd, 'public', 'fonts', 'itf')).filter((n) => n.endsWith('.woff2')) : []).toEqual([]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }, 130_000);

  it('licença ITF: nenhum .woff2/.woff/.ttf/.otf rastreado pelo git em public/ nem no repositório, e public/fonts/itf/* está no .gitignore (só o README entra)', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f) && /itf|chillax|satoshi/i.test(f))).toEqual([]);
    const ign = readFileSync('.gitignore', 'utf8');
    expect(ign).toMatch(/^\/public\/fonts\/itf\/\*$/m);
    expect(ign).toMatch(/^!\/public\/fonts\/itf\/README\.md$/m);
  });

  it('prebuild encadeia lint:auth-guard ANTES do download (falha do guard aborta antes de tocar a rede) e o app não lê as variáveis ITF_FONTS_*', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prebuild).toBe('pnpm lint:auth-guard && node scripts/build/fetch-itf-fonts.mjs');
    const r = spawnSync('git', ['grep', '-n', '-E', 'process\\.env\\.ITF_FONTS|env\\[.ITF_FONTS', '--', 'app', 'lib', 'components'], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe(''); // o runtime do app nunca lê o token das fontes
  });
});
