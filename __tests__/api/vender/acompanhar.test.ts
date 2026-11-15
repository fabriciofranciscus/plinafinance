/** GET /api/vender/acompanhar/[leadId] + serviço (item 19, Argus): detalhe só para o dono; o resto não confirma que o id existe. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(), findUnique: vi.fn(), consume: vi.fn(),
  user: { pessoaId: 'p_1' as string | null, kycAprovado: true, nome: 'Ana Souza', email: 'ana@exemplo.test', privyId: 'did:privy:1' },
  auth401: false,
}));
vi.mock('@/lib/db', () => ({ db: { leadVendedor: { findFirst: m.findFirst, findUnique: m.findUnique } } }));
vi.mock('@/lib/rate-limit/config', () => ({ publicLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: { user: unknown }) => Promise<Response>) => async (req: Request) => {
    if (m.auth401) return Response.json({ error: 'token Privy ausente' }, { status: 401 });
    return h(req, { user: m.user });
  },
}));

import { GET } from '@/app/api/vender/acompanhar/[leadId]/route';
import { acompanharDoDono, acompanharPublico } from '@/lib/services/acompanhar';

const D = (v: string) => new Prisma.Decimal(v);
const get = (id = 'lead_1') => GET(new Request(`http://x/api/vender/acompanhar/${id}`), { params: Promise.resolve({ leadId: id }) });
const lead = (over: Record<string, unknown> = {}) => ({
  id: 'lead_1', nome: 'Ana Souza', status: 'OFERTA_ENVIADA',
  ofertas: [{
    id: 'of_1', valorCarta: D('50000'), desagioAquisicao: D('0.185'), valorLiquidoVendedor: D('40750.5'), prazoRestanteMeses: 24,
    validade: new Date('2026-11-16T10:00:00Z'),
    cessao: { id: 'ces_1', status: 'ENVIADA_DOCUSIGN', onChainTxHash: 'a'.repeat(64), pagamento: { onChainTxHash: 'b'.repeat(64) }, cota: null },
  }],
  eventos: [{ stellarTxHash: 'c'.repeat(64) }],
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.auth401 = false;
  m.user = { pessoaId: 'p_1', kycAprovado: true, nome: 'Ana Souza', email: 'ana@exemplo.test', privyId: 'did:privy:1' };
  m.consume.mockReset().mockResolvedValue(true);
  m.findFirst.mockReset().mockResolvedValue(lead());
  m.findUnique.mockReset().mockResolvedValue({ status: 'OFERTA_ENVIADA' });
});

describe('GET /api/vender/acompanhar/[leadId]', () => {
  it('sem token → 401 e nada é consultado', async () => {
    m.auth401 = true;
    expect((await get()).status).toBe(401);
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('dono: 200 com o detalhe; a consulta é filtrada por id E pessoaId da sessão (nunca id vindo da requisição)', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ id: 'lead_1', pessoaId: 'p_1' });
    const b = await r.json();
    expect(b).toMatchObject({
      leadId: 'lead_1', status: 'OFERTA_ENVIADA', cedenteNome: 'Ana Souza', ofertaId: 'of_1', cessaoId: 'ces_1',
      oferta: { valorCarta: '50000.00', desagioPct: '18.5', valorLiquido: '40750.50', prazoRestanteMeses: 24, validade: '2026-11-16T10:00:00.000Z' },
      temCota: false, aguardandoAssinatura: true,
    });
    expect(b.consentTx.hashShort).toBe('cccccccc');
    expect(b.cessaoTx.hashShort).toBe('aaaaaaaa');
    expect(b.pixTx.hashShort).toBe('bbbbbbbb');
    expect(typeof b.etapaAtual).toBe('number');
  });

  it('lead de OUTRA pessoa, id inexistente e pessoa pré-KYC dão o MESMO 404 (não confirma que o id existe)', async () => {
    m.findFirst.mockResolvedValue(null); // o where por pessoaId não acha: outro dono ou inexistente
    const outro = await get();
    m.user.pessoaId = null;
    const preKyc = await get();
    expect(outro.status).toBe(404);
    expect(preKyc.status).toBe(404);
    expect(await outro.json()).toEqual({ error: 'não encontrado' });
    expect(await preKyc.json()).toEqual({ error: 'não encontrado' });
  });

  it('pessoa sem cadastro (pessoaId null) não chega ao banco', async () => {
    m.user.pessoaId = null;
    await get();
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('id inválido (vazio ou enorme) → 404 sem consultar', async () => {
    expect((await get('x'.repeat(200))).status).toBe(404);
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it('sem PII: nenhum e-mail, CPF, telefone, chave Pix nem nome fora de cedenteNome; "Nome não informado" e e-mail viram null', async () => {
    const corpo = JSON.stringify(await (await get()).json());
    expect(corpo).not.toMatch(/ana@|cpf|telefone|chavePix|pix_key|email/i);
    for (const nome of ['ana@exemplo.test', 'Nome não informado', '']) {
      m.findFirst.mockResolvedValue(lead({ nome }));
      expect((await (await get()).json()).cedenteNome).toBeNull();
    }
  });

  it('select explícito: o banco não é consultado com include nem lê e-mail/telefone do lead', async () => {
    await get();
    const arg = m.findFirst.mock.calls[0][0];
    expect(arg.include).toBeUndefined();
    expect(Object.keys(arg.select)).not.toEqual(expect.arrayContaining(['email']));
    expect(arg.select.email).toBeUndefined();
    expect(arg.select.telefone).toBeUndefined();
  });

  it('sem oferta: oferta e cessão nulas; com cota: temCota true', async () => {
    m.findFirst.mockResolvedValue(lead({ ofertas: [] }));
    expect(await (await get()).json()).toMatchObject({ oferta: null, ofertaId: null, cessaoId: null, cessaoTx: null, pixTx: null, temCota: false });
    m.findFirst.mockResolvedValue(lead({ ofertas: [{ ...lead().ofertas[0], cessao: { ...lead().ofertas[0].cessao, status: 'ASSINADA', cota: { id: 'k1' } } }] }));
    expect(await (await get()).json()).toMatchObject({ temCota: true, aguardandoAssinatura: false });
  });

  it('429 do limitador e 500 (sem causa) quando o banco falha', async () => {
    m.consume.mockResolvedValue(false);
    expect((await get()).status).toBe(429);
    m.consume.mockResolvedValue(true);
    m.findFirst.mockRejectedValue(new Error('conexão com a senha xyz caiu'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
});

describe('acompanharPublico (o que a página sem sessão pode mostrar)', () => {
  it('só status, etapa, encerrado e a descrição da etapa: nenhum dado pessoal, valor, id ou hash', async () => {
    m.findUnique.mockResolvedValue({ status: 'OFERTA_ENVIADA' });
    const r = await acompanharPublico('lead_1');
    expect(Object.keys(r!).sort()).toEqual(['contextoDescricao', 'encerrado', 'etapaAtual', 'status']);
    expect(m.findUnique.mock.calls[0][0].select).toEqual({ status: true }); // nem lê nome nem oferta
  });
  it('id inexistente → null; PERDIDO → encerrado', async () => {
    m.findUnique.mockResolvedValueOnce(null);
    expect(await acompanharPublico('nada')).toBeNull();
    m.findUnique.mockResolvedValueOnce({ status: 'PERDIDO' });
    expect((await acompanharPublico('l'))!.encerrado).toBe(true);
  });
});

describe('acompanharDoDono (serviço)', () => {
  it('pessoaId nulo → null sem tocar o banco', async () => {
    expect(await acompanharDoDono('lead_1', null)).toBeNull();
    expect(m.findFirst).not.toHaveBeenCalled();
  });
});
