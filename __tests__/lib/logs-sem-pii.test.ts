/**
 * Logs sem dado pessoal em TODOS os caminhos de erro que o Argus apontou (L3–L7): withApi (erro cru do Prisma/anchor), extractSafeError,
 * SMTP e span de telemetria. Espiona console.* e a exceção registrada no span; nada de e-mail, CPF, chave Pix, presigned, data:image
 * nem nome. Mais um guarda estático: nenhum `console.*(…, err)` com o erro cru em app/ e lib/.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sendMail: vi.fn(),
  span: { recordException: vi.fn(), setStatus: vi.fn(), setAttribute: vi.fn(), end: vi.fn() },
}));
vi.mock('@/lib/email/transporter', () => ({ getTransporter: () => ({ sendMail: m.sendMail }) }));
vi.mock('@opentelemetry/api', async (orig) => {
  const a = await orig<typeof import('@opentelemetry/api')>();
  return { ...a, trace: { getTracer: () => ({ startActiveSpan: (_n: string, _o: unknown, fn: (s: typeof m.span) => unknown) => fn(m.span) }) } };
});

import { withApi } from '@/lib/api/with-api';
import { causaSegura } from '@/lib/api/causa-segura';
import { extractSafeError } from '@/lib/stellar/log-error';
import { notifyCedente } from '@/lib/email/notify-cedente';
import { withSpan } from '@/lib/observability/tracer';
import { AnchorError } from '@/lib/anchors/types';

const EMAIL = 'ana.secreta@exemplo.test';
const CPF = '52998224725';
const NOME = 'Ana Secretíssima';
const PIX = 'chave-pix-secreta@banco.test';
const PRESIGNED = 'https://sand.etherfuse.test/onb?sig=SEGREDO_ASSINATURA';
const IMG = 'data:image/jpeg;base64,AAAA_IMAGEM_SECRETA';
const PROIBIDOS = [EMAIL, CPF, NOME, PIX, 'SEGREDO_ASSINATURA', 'data:image', 'IMAGEM_SECRETA', 'exemplo.test', 'banco.test'];

let saida: string[];
beforeEach(() => {
  saida = [];
  for (const n of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, n).mockImplementation((...a: unknown[]) => { saida.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 6 }))).join(' ')); });
  }
  m.sendMail.mockReset();
  for (const f of Object.values(m.span)) f.mockReset();
});
afterEach(() => vi.restoreAllMocks());
const semPii = (extra = '') => { const t = saida.join('\n') + extra; for (const p of PROIBIDOS) expect(t, `vazou ${p}`).not.toContain(p); };

/** Erro de Prisma de validação: a mensagem traz a chamada com os VALORES dos argumentos. */
function erroPrisma() {
  const e = new Error(`Invalid \`prisma.pessoa.create()\` invocation:\n{ data: { email: "${EMAIL}", cpf: "${CPF}", nome: "${NOME}" } }`);
  e.name = 'PrismaClientValidationError';
  return e;
}

describe('L4 — withApi não loga o erro cru', () => {
  it.each([
    ['PrismaClientValidationError com e-mail, CPF e nome na mensagem', () => erroPrisma()],
    ['AnchorError com o texto do upstream ecoando chave Pix e presigned', () => new AnchorError(`chave ${PIX} inválida em ${PRESIGNED}`, 'INVALID_PIX_KEY', 400)],
    ['Error comum com PII na mensagem', () => new Error(`falha para ${EMAIL} ${IMG}`)],
  ])('%s: 500 INTERNAL e log só com nome/code/frames', async (_n, mk) => {
    const h = withApi(async () => { throw mk(); });
    const r = await h(new Request('http://x/y'));
    expect(r.status).toBe(500);
    semPii(await r.text());
    expect(saida.join('\n')).toMatch(/\[api [0-9a-f-]+\] erro interno/);
  });
  it('mantém o que ajuda a depurar: o nome da classe e o code', async () => {
    await withApi(async () => { throw new AnchorError('x', 'MISSING_EMAIL', 400); })(new Request('http://x/y'));
    expect(saida.join('\n')).toMatch(/name: 'AnchorError'/);
    expect(saida.join('\n')).toMatch(/code: 'MISSING_EMAIL'/);
  });
});

describe('L5 — extractSafeError', () => {
  it('erro que não é do Horizon: sem message (só o nome)', () => {
    const r = extractSafeError(erroPrisma());
    expect(r.message).toBeUndefined();
    expect(r.name).toBe('PrismaClientValidationError');
    expect(JSON.stringify(r)).not.toMatch(/exemplo\.test|52998224725|Secretíssima/);
  });
  it('erro do Horizon (response.data): mantém message, status, title e result_codes', () => {
    const e = Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { status: 400, title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
    });
    expect(extractSafeError(e)).toMatchObject({ message: 'Request failed with status code 400', status: 400, title: 'Transaction Failed', result_codes: { transaction: 'tx_bad_seq' } });
  });
});

describe('L6 — SMTP', () => {
  it('notifyCedente: erro do nodemailer que cita o destinatário não vai ao log; fica o code', async () => {
    m.sendMail.mockRejectedValue(Object.assign(new Error(`Recipient ${EMAIL} rejected: 550 5.1.1 user unknown`), { code: 'EENVELOPE', responseCode: 550 }));
    await notifyCedente(EMAIL, 'oferta', { leadId: 'l1', nome: 'Ana' });
    semPii();
    expect(saida.join('\n')).toMatch(/code: 'EENVELOPE'/);
    expect(saida.join('\n')).toMatch(/responseCode: 550/);
  });
});

describe('L3/L7 — span de telemetria', () => {
  it('a exceção e o status do span não levam a mensagem do erro (só nome e code)', async () => {
    await expect(withSpan('etherfuse.request', {}, async () => { throw new AnchorError(`chave ${PIX} de ${EMAIL}`, 'INVALID_PIX_KEY', 400); })).rejects.toBeDefined();
    const dump = JSON.stringify([m.span.recordException.mock.calls, m.span.setStatus.mock.calls]);
    for (const p of PROIBIDOS) expect(dump, `vazou ${p}`).not.toContain(p);
    expect(dump).toContain('INVALID_PIX_KEY');
  });
});

describe('causaSegura', () => {
  it('nome, code, status e frames; nunca message; frames só com linhas "at"', () => {
    const e = Object.assign(new Error(`a\nb ${EMAIL}\nat fake (x:1:1)`), { name: 'MeuErro', code: 'P2002', statusCode: 400 });
    const c = causaSegura(e);
    expect(c).toMatchObject({ name: 'MeuErro', code: 'P2002', status: 400 });
    expect(JSON.stringify(c)).not.toContain(EMAIL);
    expect(c.frames!.every((f) => f.startsWith('at '))).toBe(true);
    expect(causaSegura('texto com ' + EMAIL)).toEqual({ name: 'erro' });
    expect(causaSegura(null)).toEqual({ name: 'erro' });
  });
});

describe('guarda estático: nenhum console.* recebe o erro cru em app/ e lib/', () => {
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === 'node_modules' || n === '__tests__' || n.startsWith('.')) return [];
      return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }
  it('sem `console.(error|warn|log|info)(..., err)` nem `err.message` em log', () => {
    const ruim: string[] = [];
    for (const f of [...arquivos(join(process.cwd(), 'app')), ...arquivos(join(process.cwd(), 'lib'))]) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (/console\.(error|warn|log|info)\(/.test(l) && (/,\s*(err|error|e|cause|regErr|kycErr)\s*\)/.test(l) || /(err|error|e)\.message/.test(l))) ruim.push(`${f.replace(process.cwd() + '/', '')}:${i + 1}`);
      });
    }
    expect(ruim).toEqual([]);
  });
});
