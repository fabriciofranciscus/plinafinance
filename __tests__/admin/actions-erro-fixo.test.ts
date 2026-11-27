/**
 * Server Actions do /admin: o erro devolvido à tela é FIXO. Nunca `err.message` cru (Prisma ecoa valores, Stellar/anchor ecoam o que
 * foi enviado, `Error` simples cita ids e nomes de variável): regra do #100 / dívida U1-11. Classes de domínio conhecidas devolvem a
 * própria mensagem fixa + `code`; qualquer outra coisa vira 'erro interno' (causa só no log, sem mensagem).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  incorporarCota: vi.fn(), executarClawback: vi.fn(), registrarValidacaoLegal: vi.fn(),
  log: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({
  clearAdminCookie: vi.fn(), isAdminAuthenticated: vi.fn().mockResolvedValue(true), passwordMatches: vi.fn(), setAdminCookie: vi.fn(),
}));
vi.mock('@/lib/rate-limit/config', () => ({ adminLoginLimiter: { consume: vi.fn().mockResolvedValue(true), reset: vi.fn() } }));
vi.mock('@/lib/services/tokenizacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/tokenizacao')>()),
  incorporarCota: m.incorporarCota, executarClawback: m.executarClawback,
}));
vi.mock('@/lib/services/originacao', () => ({ registrarValidacaoLegal: m.registrarValidacaoLegal }));

import { incorporarCotaAction, registrarValidacaoLegalAction } from '@/app/admin/actions';
import { IncorporacaoBloqueadaError, IncorporacaoEmissaoError } from '@/lib/services/tokenizacao';

const SEGREDO = 'Invalid `prisma.cota.update()` invocation: cota cmk123 email fulana@exemplo.test STELLAR_ISSUER_SECRET GSECRET';
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  vi.spyOn(console, 'error').mockImplementation((...a) => { m.log(...a); });
});

const ACOES: Array<[string, () => Promise<{ ok: boolean; error?: string }>, ReturnType<typeof vi.fn>]> = [
  ['incorporarCotaAction', () => incorporarCotaAction(null, fd({ tipoBem: 'IMOVEL', administradora: 'x', valorCarta: '1', desagioAquisicao: '0.1' })), m.incorporarCota],
  ['registrarValidacaoLegalAction', () => registrarValidacaoLegalAction(null, fd({ cotaId: 'c1', laudoUrl: 'https://l.test/x' })), m.registrarValidacaoLegal],
];

describe('actions do /admin — erro fixo', () => {
  for (const [nome, chamar, servico] of ACOES) {
    it(`${nome}: erro desconhecido (Prisma/Error simples) vira 'erro interno', sem a mensagem, e a causa vai ao log sem mensagem`, async () => {
      servico.mockRejectedValue(new Error(SEGREDO));
      const r = await chamar();
      expect(r).toEqual({ ok: false, error: 'erro interno' });
      expect(JSON.stringify(r)).not.toMatch(/prisma|cmk123|exemplo|SECRET/i);
      expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/cmk123|exemplo\.test|GSECRET/);
    });
    it(`${nome}: valor que não é Error também vira 'erro interno' (nunca 'unknown' nem o valor)`, async () => {
      servico.mockRejectedValue('texto cru ' + SEGREDO);
      expect(await chamar()).toEqual({ ok: false, error: 'erro interno' });
    });
  }

  it('incorporarCotaAction: IncorporacaoBloqueadaError devolve a mensagem FIXA da classe + code', async () => {
    m.incorporarCota.mockRejectedValue(new IncorporacaoBloqueadaError('LAUDO_AUSENTE'));
    const r = await ACOES[0]![1]();
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: 'LAUDO_AUSENTE' });
    expect(r.error).toBe(new IncorporacaoBloqueadaError('LAUDO_AUSENTE').message);
  });

  it('incorporarCotaAction: IncorporacaoEmissaoError devolve a mensagem da classe + code', async () => {
    m.incorporarCota.mockRejectedValue(new IncorporacaoEmissaoError('EMISSAO_FALHOU', { resultCodes: { secreto: 'x' } }));
    const r = await ACOES[0]![1]();
    expect(r).toMatchObject({ ok: false, code: 'EMISSAO_FALHOU' });
    expect(JSON.stringify(r)).not.toMatch(/secreto/);
  });

  it('registrarValidacaoLegalAction: laudoUrl inválida recebe mensagem fixa de validação, sem chamar o serviço', async () => {
    const r = await registrarValidacaoLegalAction(null, fd({ cotaId: 'c1', laudoUrl: 'ftp://x' }));
    expect(r).toEqual({ ok: false, error: 'laudoUrl obrigatória (URL pública do documento).' });
    expect(m.registrarValidacaoLegal).not.toHaveBeenCalled();
  });

  it('sucesso continua igual (formato e txHash)', async () => {
    m.registrarValidacaoLegal.mockResolvedValue({ txHash: 'abc' });
    expect(await registrarValidacaoLegalAction(null, fd({ cotaId: 'c1', laudoUrl: 'https://l.test/x' }))).toEqual({ ok: true, txHash: 'abc' });
  });

  it('guarda estática: nenhuma action de app/admin/actions.ts devolve err.message cru (exceto o clawback, tratado em fix/clawback-idempotente)', () => {
    const src = readFileSync(join(process.cwd(), 'app/admin/actions.ts'), 'utf8');
    const semClawback = src.replace(/export async function executarClawbackAction[\s\S]*?\n}\n/, '');
    expect(semClawback).not.toMatch(/err instanceof Error \? err\.message|\.message\s*:/);
    expect(semClawback).not.toMatch(/error:[^\n]*'unknown'/);
  });
});
