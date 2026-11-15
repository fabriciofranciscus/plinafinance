/** Rota admin/originacao — pré-condições do funil que o operador corrige: 404/409 com code e mensagem fixa, nunca 500 (item 14, G5). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  gerar: vi.fn(), cessao: vi.fn(), enviar: vi.fn(), laudo: vi.fn(), anuencia: vi.fn(), incorporar: vi.fn(), isAdmin: vi.fn(), csrf: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: m.isAdmin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: m.csrf }));
vi.mock('@/lib/services/originacao', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/originacao')>()),
  gerarOferta: m.gerar, registrarCessao: m.cessao, registrarLaudoDaCessao: m.laudo, registrarAnuencia: m.anuencia,
  incorporarCotaDoFunil: m.incorporar,
}));
vi.mock('@/lib/services/cessao-docusign', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/cessao-docusign')>()),
  enviarCessaoParaAssinatura: m.enviar,
}));
vi.mock('@/lib/services/tesouraria-legada', () => ({ registrarTesourariaLegada: vi.fn() }));

import { POST } from '@/app/api/admin/originacao/route';
import { EnvioDocusignEmAndamentoError } from '@/lib/services/cessao-docusign';
import { OriginacaoPrecondicaoError, type OriginacaoPrecondicaoCode } from '@/lib/services/originacao-erros';

const req = (body: unknown) =>
  new Request('http://x/api/admin/originacao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const GERAR = { action: 'gerar-oferta', leadVendedorId: 'l1', tipoBem: 'VEICULO', valorCarta: '100000', administradora: 'Porto', desagioAquisicao: '0.2' };
const ACOES = {
  gerar: { fn: () => m.gerar, body: GERAR },
  cessao: { fn: () => m.cessao, body: { action: 'registrar-cessao', ofertaId: 'o1' } },
  enviar: { fn: () => m.enviar, body: { action: 'enviar-cessao', cessaoId: 'c1' } },
  laudo: { fn: () => m.laudo, body: { action: 'registrar-laudo', cessaoId: 'c1', laudoUrl: 'https://x.test/l.pdf#sha256=ab' } },
  anuencia: { fn: () => m.anuencia, body: { action: 'registrar-anuencia', hashValidacao: 'a'.repeat(64), status: 'DECLARADA_PENDENTE' } },
  incorporar: { fn: () => m.incorporar, body: { action: 'incorporar-cota', cessaoId: 'c1' } },
} as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const k of ['gerar', 'cessao', 'enviar', 'laudo', 'anuencia', 'incorporar'] as const) m[k].mockReset();
  m.isAdmin.mockReset().mockResolvedValue(true);
  m.csrf.mockReset().mockReturnValue(null);
});

const CASOS: Array<[keyof typeof ACOES, OriginacaoPrecondicaoCode, number]> = [
  ['gerar', 'LEAD_NAO_ENCONTRADO', 404],
  ['cessao', 'OFERTA_NAO_ENCONTRADA', 404],
  ['cessao', 'OFERTA_NAO_ACEITA', 409],
  ['enviar', 'CESSAO_NAO_ENCONTRADA', 404],
  ['enviar', 'CESSAO_ESTADO_INVALIDO', 409],
  ['enviar', 'CEDENTE_SEM_EMAIL', 409],
  ['laudo', 'CESSAO_NAO_ENCONTRADA', 404],
  ['laudo', 'CESSAO_JA_TEM_COTA', 409],
  ['anuencia', 'LAUDO_NAO_ENCONTRADO', 404],
  ['anuencia', 'ANUENCIA_SEM_REFERENCIA', 409],
  ['anuencia', 'ANUENCIA_DECLARADA_EM_MAINNET', 409],
  ['incorporar', 'CESSAO_NAO_ENCONTRADA', 404],
  ['incorporar', 'CESSAO_JA_TEM_COTA', 409],
];

describe('admin/originacao — pré-condições (G5)', () => {
  it.each(CASOS)('%s: %s → %i com { error, code } e mais nada', async (acao, code, status) => {
    ACOES[acao].fn().mockRejectedValue(new OriginacaoPrecondicaoError(code, 'mensagem fixa'));
    const r = await POST(req(ACOES[acao].body));
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ error: 'mensagem fixa', code });
  });

  it('envio concorrente ao DocuSign → 409 ENVIO_DOCUSIGN_EM_ANDAMENTO (antes era 500 sem code)', async () => {
    m.enviar.mockRejectedValue(new EnvioDocusignEmAndamentoError());
    const r = await POST(req(ACOES.enviar.body));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('ENVIO_DOCUSIGN_EM_ANDAMENTO');
  });

  it('cada code mapeia para 404 só quando "não encontrado"; o resto é 409', () => {
    for (const [, code, status] of CASOS) expect(new OriginacaoPrecondicaoError(code, 'x').status).toBe(status);
  });

  it('um erro qualquer (não de pré-condição) continua 500: a rota não mascara falha do servidor', async () => {
    m.cessao.mockRejectedValue(new Error('falha de banco'));
    expect((await POST(req(ACOES.cessao.body))).status).toBe(500);
  });

  it('sem sessão admin → 401 e o serviço não é chamado', async () => {
    m.isAdmin.mockResolvedValue(false);
    expect((await POST(req(ACOES.cessao.body))).status).toBe(401);
    expect(m.cessao).not.toHaveBeenCalled();
  });
});
