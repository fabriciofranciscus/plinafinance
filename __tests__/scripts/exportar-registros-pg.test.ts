/**
 * L2 com Postgres REAL: exportarRegistros lê a cota, confere hash = registro = memo (Horizon simulado), varre dado pessoal e só
 * então grava os BYTES exatos. Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db (só host local; nunca o Neon).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('local apenas');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

import { db } from '@/lib/db';
import { buildAuditPayload, stableSerialize } from '@/lib/stellar/audit';
import { bytesCanonicos } from '@/lib/services/json-canonico';
import { exportarRegistros } from '../../scripts/evidencia-cota/exportar';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const TX_VAL = '1'.repeat(64);
const TX_INC = '2'.repeat(64);
const NOME = 'Fulana de Tal Silva';
const LIMPAR = 'TRUNCATE "EventoAudit","Cota","Cessao","Oferta","LeadVendedor","Pessoa" RESTART IDENTITY CASCADE';

const payload = (operador = 'admin-panel', extra: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify(buildAuditPayload('cota_validacao', 'cessao_x', { cessaoId: 'cessao_x', laudoUrl: 'https://x.example/laudo.pdf#sha256=' + 'b'.repeat(64), administradora: 'Administradora Demonstração (fictícia)', tipoBem: 'IMOVEL', operador, ...extra })));
const registro = (extra: Record<string, unknown> = {}) => ({
  tipo: 'COTA_INCORPORADA', versao: 1, cotaId: 'inc_x', cessaoId: 'cessao_x', hashLaudo: 'c'.repeat(64), sha256PdfCessao: 'd'.repeat(64),
  comprovantePixSha256: 'e'.repeat(64), comprovantePixAncoraTxHash: 'f'.repeat(64), valorIncorporadoBrl: '31200.00', tokensEmitir: '31200.0000000',
  navPorTokenUsado: '1.00000000', issuer: 'GISS', asset: 'PLINARF', ...extra,
});

let pasta: string;
/** Horizon simulado: cada tx tem o memo do sha que o teste manda. */
const memos: Record<string, string> = {};
const fetchFalso = (async (url: string) => {
  const tx = String(url).split('/').pop()!;
  if (!(tx in memos)) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify({ successful: true, memo_type: 'hash', memo: Buffer.from(memos[tx]!, 'hex').toString('base64') }), { status: 200 });
}) as unknown as typeof fetch;

async function semear(over: { laudo?: Record<string, unknown>; reg?: Record<string, unknown>; operador?: string } = {}) {
  const p = payload(over.operador, over.laudo);
  const hashLaudo = sha(stableSerialize(p));
  const reg = registro(over.reg);
  const bytesReg = bytesCanonicos(reg);
  const hashReg = sha(bytesReg);
  await db.pessoa.create({ data: { id: 'pX', privyId: 'did:privy:x', email: 'fulana@exemplo.test', nome: NOME, publicKey: 'GpX', kycAprovado: true, cpfNormalizado: '12345678909' } });
  await db.leadVendedor.create({ data: { id: 'leadX', nome: NOME, email: 'lead-x@exemplo.test', pessoaId: 'pX', status: 'COTA_INCORPORADA' } });
  await db.oferta.create({ data: { id: 'ofX', leadVendedorId: 'leadX', tipoBem: 'IMOVEL', valorCarta: '40000', administradora: 'Adm', desagioAquisicao: '0.2200', valorLiquidoVendedor: '31200', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
  await db.cessao.create({ data: { id: 'cessaoX', ofertaId: 'ofX', status: 'ASSINADA' } });
  await db.cota.create({ data: { id: 'inc_x', tipoBem: 'IMOVEL', administradora: 'Adm', valorCarta: '40000', desagioAquisicao: '0.2200', status: 'DISPONIVEL', cessaoId: 'cessaoX', hashValidacao: hashLaudo, validacaoTxHash: TX_VAL } });
  await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'admin-panel', cessaoId: 'cessaoX', payloadJson: p, payloadHash: hashLaudo, stellarTxHash: TX_VAL } });
  await db.eventoAudit.create({ data: { acao: 'COTA_INCORPORADA', operador: 'admin-panel', cotaId: 'inc_x', payloadJson: { registroCanonico: reg, ancoraTxHash: TX_INC }, payloadHash: hashReg } });
  memos[TX_VAL] = hashLaudo;
  memos[TX_INC] = hashReg;
  return { p, hashLaudo, bytesReg, hashReg };
}
const rodar = () => exportarRegistros({ cotaId: 'inc_x', db, fetchFn: fetchFalso, horizonUrl: 'https://h.example.test', destinoBase: pasta });

describe.skipIf(!PG)('exportarRegistros (Postgres real)', () => {
  beforeAll(() => { pasta = mkdtempSync(join(tmpdir(), 'registros-')); });
  beforeEach(async () => { await db.$executeRawUnsafe(LIMPAR); for (const k of Object.keys(memos)) delete memos[k]; });
  afterEach(() => { for (const f of existsSync(join(pasta, 'registros-canonicos-inc_x')) ? [join(pasta, 'registros-canonicos-inc_x')] : []) rmSync(f, { recursive: true, force: true }); });
  afterAll(async () => { rmSync(pasta, { recursive: true, force: true }); await db.$executeRawUnsafe(LIMPAR); await db.$disconnect(); });

  it('os 2 prontos: arquivos com os BYTES exatos, nomes pelo hash, manifesto sem pessoa; sha256(arquivo) = hash = memo', async () => {
    const { p, hashLaudo, bytesReg, hashReg } = await semear();
    const r = await rodar();
    expect(r.tudoOk).toBe(true);
    const dir = join(pasta, 'registros-canonicos-inc_x');
    expect(readdirSync(dir).sort()).toEqual([`registro-incorporacao-${hashReg.slice(0, 8)}.json`, `registro-validacao-${hashLaudo.slice(0, 8)}.json`, 'manifesto.json'].sort());
    const val = readFileSync(join(dir, `registro-validacao-${hashLaudo.slice(0, 8)}.json`));
    const inc = readFileSync(join(dir, `registro-incorporacao-${hashReg.slice(0, 8)}.json`));
    expect(val.toString('utf8')).toBe(stableSerialize(p));
    expect(Buffer.compare(inc, bytesReg)).toBe(0);
    expect(sha(val)).toBe(hashLaudo);
    expect(sha(inc)).toBe(hashReg);
    const manifesto = readFileSync(join(dir, 'manifesto.json'), 'utf8');
    expect(manifesto).not.toMatch(/Fulana|fulana|12345678909|@/);
    expect(JSON.parse(manifesto).registros.map((x: { ocorrenciasDePessoa: number }) => x.ocorrenciasDePessoa)).toEqual([0, 0]);
  });

  it('nome do cedente dentro do registro → recusa, e NENHUM arquivo desse registro é gravado (nem o nome impresso)', async () => {
    await semear({ reg: { observacao: `cedente ${NOME}` } });
    const r = await rodar();
    expect(r.tudoOk).toBe(false);
    const inc = r.linhas.find((l) => l.registro === 'incorporacao')!;
    expect(inc.ok).toBe(false);
    expect(inc.motivo).toMatch(/PII/);
    expect(JSON.stringify(r)).not.toMatch(/Fulana/);
    const dir = join(pasta, 'registros-canonicos-inc_x');
    expect(readdirSync(dir).some((f) => f.startsWith('registro-incorporacao'))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith('registro-validacao'))).toBe(true); // o outro, limpo, sai
  });

  it('memo na rede diferente do sha256 → recusa e não grava', async () => {
    await semear();
    memos[TX_INC] = 'ee'.repeat(32);
    const r = await rodar();
    expect(r.linhas.find((l) => l.registro === 'incorporacao')).toMatchObject({ ok: false, motivo: expect.stringMatching(/MEMO_DIVERGE/) });
    expect(existsSync(join(pasta, 'registros-canonicos-inc_x'))).toBe(true);
    expect(readdirSync(join(pasta, 'registros-canonicos-inc_x')).some((f) => f.startsWith('registro-incorporacao'))).toBe(false);
  });

  it('tx da âncora não encontrada na rede → recusa', async () => {
    await semear();
    delete memos[TX_VAL];
    const r = await rodar();
    expect(r.linhas.find((l) => l.registro === 'validacao')).toMatchObject({ ok: false, motivo: 'TX_NAO_ENCONTRADA' });
    expect(r.tudoOk).toBe(false);
  });

  it('operador que é pessoa (e-mail) → a validação é recusada', async () => {
    await semear({ operador: 'maria@exemplo.com' });
    const r = await rodar();
    expect(r.linhas.find((l) => l.registro === 'validacao')).toMatchObject({ ok: false, motivo: expect.stringMatching(/OPERADOR_NAO_E_FUNCAO/) });
  });

  it('cota inexistente → erro claro; cota sem registros → recusa os dois (nada gravado)', async () => {
    await expect(rodar()).rejects.toThrow(/não encontrada/);
    await db.cota.create({ data: { id: 'inc_x', tipoBem: 'IMOVEL', administradora: 'Adm', valorCarta: '1', desagioAquisicao: '0.1', status: 'DISPONIVEL' } });
    const r = await rodar();
    expect(r.tudoOk).toBe(false);
    expect(r.linhas.map((l) => l.motivo)).toEqual([expect.stringMatching(/SEM_LAUDO/), expect.stringMatching(/SEM_REGISTRO/)]);
    expect(existsSync(join(pasta, 'registros-canonicos-inc_x'))).toBe(false);
  });
});
