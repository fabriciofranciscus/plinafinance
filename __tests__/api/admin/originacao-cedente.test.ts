/** Rota admin/originacao — cases do E1-2 (D3) e do fluxo da cota de prova: titular, pagar, reabrir, registrar/enviar cessão. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const m = vi.hoisted(() => ({
  cessao: vi.fn(), enviar: vi.fn(), incorporar: vi.fn(), isAdmin: vi.fn(), csrf: vi.fn(), confirmar: vi.fn(), pagar: vi.fn(), reabrir: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: m.isAdmin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: m.csrf }));
vi.mock('@/lib/services/originacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/originacao')>()),
  gerarOferta: vi.fn(), registrarAnuencia: vi.fn(), registrarLaudoDaCessao: vi.fn(),
  incorporarCotaDoFunil: m.incorporar, registrarCessao: m.cessao,
}));
vi.mock('@/lib/services/cessao-docusign', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/cessao-docusign')>()),
  enviarCessaoParaAssinatura: m.enviar,
}));
vi.mock('@/lib/services/tesouraria-legada', () => ({ registrarTesourariaLegada: vi.fn() }));
vi.mock('@/lib/services/titular-laudo', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/titular-laudo')>()),
  confirmarTitularDoLaudo: m.confirmar,
}));
vi.mock('@/lib/services/pagamento-cedente', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pagamento-cedente')>()),
  pagarCedenteDaCessao: m.pagar,
  reabrirPagamentoCedente: m.reabrir,
}));

import { POST } from '@/app/api/admin/originacao/route';
import { EnvioDocusignLaudoAusenteError } from '@/lib/services/cessao-docusign';
import { IncorporacaoFunilBloqueadaError } from '@/lib/services/originacao';
import { PagamentoCedenteError } from '@/lib/services/pagamento-cedente';
import { LiquidacaoCedenteError } from '@/lib/services/liquidacao-cedente';
import { TitularLaudoError } from '@/lib/services/titular-laudo';

const req = (body: unknown) =>
  new Request('http://x/api/admin/originacao', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.cessao.mockReset().mockResolvedValue({ status: 'PENDENTE' });
  m.enviar.mockReset().mockResolvedValue({ status: 'ENVIADA_DOCUSIGN', envelopeId: 'env_1' });
  m.incorporar.mockReset().mockResolvedValue({ cotaId: 'cota_1' });
  m.isAdmin.mockReset().mockResolvedValue(true);
  m.csrf.mockReset().mockReturnValue(null);
  m.confirmar.mockReset().mockResolvedValue({ situacao: 'TITULAR_UNICO', pagamentoAutomatico: true });
  m.pagar.mockReset().mockResolvedValue({ status: 'COMPROVADA', pagamentoId: 'pg_1', sha256: 'a'.repeat(64), txHash: 'tx1' });
  m.reabrir.mockReset().mockResolvedValue({ status: 'PROCESSANDO', sha256: 'b'.repeat(64) });
});

const CASES = [
  { action: 'confirmar-titular-laudo', fn: () => m.confirmar, body: { situacao: 'TITULAR_UNICO', atestado: true } },
  { action: 'pagar-cedente', fn: () => m.pagar, body: {} },
  { action: 'reabrir-pagamento-cedente', fn: () => m.reabrir, body: {} },
] as const;

describe.each(CASES)('admin/originacao — $action', ({ action, fn, body }) => {
  const ok = { action, cessaoId: 'ces_1', ...body };

  it('sem CSRF → resposta do guard; sem sessão admin → 401; o serviço NÃO é chamado', async () => {
    m.csrf.mockReturnValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await POST(req(ok))).status).toBe(403);
    m.csrf.mockReturnValue(null);
    m.isAdmin.mockResolvedValue(false);
    expect((await POST(req(ok))).status).toBe(401);
    expect(fn()).not.toHaveBeenCalled();
  });

  it('sucesso: devolve o resultado do serviço; operador = constante do servidor; o serviço NÃO recebe opts', async () => {
    const r = await POST(req(ok));
    expect(r.status).toBe(200);
    const [input, ...resto] = fn().mock.calls[0];
    expect(input).toMatchObject({ cessaoId: 'ces_1', operador: 'admin-panel' });
    expect(resto).toHaveLength(0); // nunca provedor/provider/agora vindos do chamador
  });

  it.each([
    ['operador no body', { operador: 'fulano' }],
    ['provedor no body', { provedor: 'SIMULADO' }],
    ['provider no body', { provider: 'ASAAS' }],
    ['opts no body', { opts: { provedor: 'SIMULADO' } }],
    ['chave Pix no body', { chavePix: '12345678909', tipoChave: 'CPF' }],
    ['valor no body', { valor: '1.00' }],
    ['documento no body', { documento: '12345678909' }],
  ])('body estrito: %s → 400 e o serviço NÃO é chamado', async (_n, extra) => {
    const r = await POST(req({ ...ok, ...extra }));
    expect(r.status).toBe(400);
    expect(fn()).not.toHaveBeenCalled();
  });

  it('cessaoId ausente, vazio ou não-string → 400', async () => {
    for (const bad of [undefined, '', 123, null]) {
      const r = await POST(req({ ...ok, cessaoId: bad }));
      expect(r.status).toBe(400);
    }
    expect(fn()).not.toHaveBeenCalled();
  });
});

describe('confirmar-titular-laudo — corpo', () => {
  const base = { action: 'confirmar-titular-laudo', cessaoId: 'ces_1' };
  it('atestado precisa ser exatamente true (false, "true", 1 e ausente → 400)', async () => {
    for (const atestado of [false, 'true', 1, undefined]) {
      const r = await POST(req({ ...base, situacao: 'TITULAR_UNICO', atestado }));
      expect(r.status).toBe(400);
    }
    expect(m.confirmar).not.toHaveBeenCalled();
  });
  it('situacao só aceita os 4 valores do serviço', async () => {
    expect((await POST(req({ ...base, situacao: 'OUTRO', atestado: true }))).status).toBe(400);
    for (const situacao of ['TITULAR_UNICO', 'ESPOLIO', 'COTITULARIDADE', 'PROCURADOR']) {
      expect((await POST(req({ ...base, situacao, atestado: true }))).status).toBe(200);
    }
    expect(m.confirmar).toHaveBeenCalledTimes(4);
    expect(m.confirmar.mock.calls[0][0]).toEqual({ cessaoId: 'ces_1', situacao: 'TITULAR_UNICO', atestado: true, operador: 'admin-panel' });
  });
});

describe('erros de domínio do E1-2 → mensagem fixa + código, sem vazar causa', () => {
  const pagar = { action: 'pagar-cedente', cessaoId: 'ces_1' };
  it.each([
    [new PagamentoCedenteError('CESSAO_NAO_ASSINADA'), 409, 'CESSAO_NAO_ASSINADA'],
    [new PagamentoCedenteError('TITULAR_DIVERGE'), 409, 'TITULAR_DIVERGE'],
    [new PagamentoCedenteError('CESSAO_NAO_ENCONTRADA'), 404, 'CESSAO_NAO_ENCONTRADA'],
    [new PagamentoCedenteError('TETO_NAO_CONFIGURADO'), 503, 'TETO_NAO_CONFIGURADO'],
    [new LiquidacaoCedenteError('VALOR_DIVERGE'), 409, 'VALOR_DIVERGE'],
    [new LiquidacaoCedenteError('ENTRADA_INVALIDA'), 400, 'ENTRADA_INVALIDA'],
    [new TitularLaudoError('TITULAR_NAO_CONFIRMADO'), 409, 'TITULAR_NAO_CONFIRMADO'],
    [new TitularLaudoError('SEGREDO_NAO_CONFIGURADO'), 503, 'SEGREDO_NAO_CONFIGURADO'],
  ])('%s', async (erro, status, code) => {
    m.pagar.mockRejectedValue(erro);
    const r = await POST(req(pagar));
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ error: erro.message, code });
  });

  it('erro de domínio com "causa" (LiquidacaoCedenteError) não expõe a causa', async () => {
    m.pagar.mockRejectedValue(new LiquidacaoCedenteError('COMPROVANTE_FALHOU', 'SEGREDO_INTERNO'));
    const r = await POST(req(pagar));
    expect(JSON.stringify(await r.json())).not.toContain('SEGREDO_INTERNO');
  });

  it('o resultado do serviço não leva chave Pix nem CPF (só status, ids e hashes)', async () => {
    const r = await POST(req(pagar));
    expect(Object.keys(await r.json()).sort()).toEqual(['pagamentoId', 'sha256', 'status', 'txHash']);
  });
});

describe('executar-pix-simulado SAIU da rota (Atlas 13/11): o único pagamento é o pagar-cedente', () => {
  it('a action não existe mais: 400, e nenhum serviço de Pix é chamado', async () => {
    const r = await POST(req({ action: 'executar-pix-simulado', cessaoId: 'ces_1' }));
    expect(r.status).toBe(400);
  });
});

describe('registrar-cessao / enviar-cessao (laudo antes do envelope)', () => {
  it('registrar-cessao só CRIA a cessão (enviar:false), com o operador do servidor', async () => {
    const r = await POST(req({ action: 'registrar-cessao', ofertaId: 'of_1' }));
    expect(r.status).toBe(200);
    expect(m.cessao).toHaveBeenCalledWith({ ofertaId: 'of_1', operador: 'admin-panel', enviar: false });
  });

  it('registrar-cessao: o corpo NÃO pode forçar o envio (enviar no body = 400)', async () => {
    for (const extra of [{ enviar: true }, { enviar: false }, { operador: 'x' }]) {
      expect((await POST(req({ action: 'registrar-cessao', ofertaId: 'of_1', ...extra }))).status).toBe(400);
    }
    expect(m.cessao).not.toHaveBeenCalled();
  });

  it('enviar-cessao: chama o serviço só com { cessaoId, operador do servidor }', async () => {
    const r = await POST(req({ action: 'enviar-cessao', cessaoId: 'ces_1' }));
    expect(r.status).toBe(200);
    expect(m.enviar).toHaveBeenCalledWith({ cessaoId: 'ces_1', operador: 'admin-panel' });
  });

  it.each([{ operador: 'x' }, { enviar: true }, { provedor: 'SIMULADO' }, { laudo: 'a' }])('enviar-cessao: corpo estrito (%o) → 400, sem envio', async (extra) => {
    expect((await POST(req({ action: 'enviar-cessao', cessaoId: 'ces_1', ...extra }))).status).toBe(400);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('enviar-cessao sem sessão admin → 401; sem CSRF → o guard', async () => {
    m.isAdmin.mockResolvedValue(false);
    expect((await POST(req({ action: 'enviar-cessao', cessaoId: 'ces_1' }))).status).toBe(401);
    m.isAdmin.mockResolvedValue(true);
    m.csrf.mockReturnValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    expect((await POST(req({ action: 'enviar-cessao', cessaoId: 'ces_1' }))).status).toBe(403);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('enviar-cessao sem laudo registrado → 409 LAUDO_AUSENTE com mensagem fixa (qualquer rede)', async () => {
    const erro = new EnvioDocusignLaudoAusenteError();
    m.enviar.mockRejectedValue(erro);
    const r = await POST(req({ action: 'enviar-cessao', cessaoId: 'ces_1' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: erro.message, code: 'LAUDO_AUSENTE' });
  });
});

describe('incorporar-cota — provas do funil (IncorporacaoFunilBloqueadaError → 409)', () => {
  it.each(['CESSAO_NAO_ASSINADA', 'PIX_NAO_COMPROVADO', 'PAGAMENTO_NAO_EXECUTADO', 'COTA_JA_INCORPORADA'] as const)('%s → 409 com o código e mensagem fixa', async (code) => {
    const erro = new IncorporacaoFunilBloqueadaError(code);
    m.incorporar.mockRejectedValue(erro);
    const r = await POST(req({ action: 'incorporar-cota', cessaoId: 'ces_1' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: erro.message, code });
  });
});
