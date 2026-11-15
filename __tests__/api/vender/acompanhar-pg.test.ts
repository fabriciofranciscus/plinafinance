/**
 * QA (Vera) — item 19 com Postgres REAL, pelas rotas: GET /api/vender/acompanhar/[leadId] (só o dono; 404 uniforme)
 * (item 19). O caso de /api/vender/minhas (concluido só com a cota) fica em minhas-concluido-pg.test.ts. Mock só do verificador do Privy (tok-<x> → did:privy:<x>).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) { if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('local apenas'); process.env.DATABASE_URL = url; process.env.DIRECT_URL = url; }
  return url;
});
vi.mock('@/lib/wallet/privy', async (orig) => ({ ...(await orig<typeof import('@/lib/wallet/privy')>()), verifyPrivyTokenLite: async (t: string) => { if (!t.startsWith('tok-')) throw new Error('x'); return { userId: `did:privy:${t.slice(4)}`, email: `${t.slice(4)}@exemplo.test` }; } }));
import { db } from '@/lib/db';
import { GET as acompanhar } from '@/app/api/vender/acompanhar/[leadId]/route';

const LIMPAR = 'TRUNCATE "Cessao","Oferta","EventoAudit","LeadVendedor","Pessoa" RESTART IDENTITY CASCADE';
let ip = 0, n = 0;
const hdr = (token?: string) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': `10.19.${Math.floor(++ip / 250)}.${ip % 250}` });
const getAcomp = async (leadId: string, token?: string) => { const r = await acompanhar(new Request(`http://x/api/vender/acompanhar/${leadId}`, { headers: hdr(token) }), { params: Promise.resolve({ leadId }) }); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ } return { status: r.status, texto: t, json: j, ct: r.headers.get('content-type') }; };
const pessoa = (x: string) => db.pessoa.create({ data: { id: `p${x}`, privyId: `did:privy:${x}`, email: `${x}@exemplo.test`, nome: `Nome ${x}`, publicKey: `G${x}`.padEnd(56, 'A').slice(0, 56), cpfNormalizado: '52998224725', kycAprovado: true } });
const lead = async (pessoaId: string | null, status = 'OFERTA_ENVIADA') => { n += 1; const l = await db.leadVendedor.create({ data: { nome: `Fulano Secreto ${n}`, email: `fulano.secreto${n}@exemplo.test`, telefone: '+5511999990000', pessoaId, status } as never }); await db.oferta.create({ data: { leadVendedorId: l.id, tipoBem: 'IMOVEL', valorCarta: '40000', administradora: 'Adm Secreta', desagioAquisicao: '0.22', valorLiquidoVendedor: '31200', validade: new Date(Date.now() + 86_400_000), status: 'ENVIADA' } as never }); return l; };

describe.skipIf(!PG)('item 19 — acompanhar só do dono', () => {
  beforeEach(async () => { await db.$executeRawUnsafe(LIMPAR); });
  afterAll(async () => { await db.$executeRawUnsafe(LIMPAR); await db.$disconnect(); });

  it('sem token / token inválido → 401', async () => {
    const a = await pessoa('a'); const l = await lead(a.id);
    expect((await getAcomp(l.id)).status).toBe(401); expect((await getAcomp(l.id, 'lixo')).status).toBe(401);
  });
  it('dono → 200 com o detalhe (valores da própria proposta); nunca e-mail, telefone, CPF, administradora nem chave', async () => {
    const a = await pessoa('a'); const l = await lead(a.id);
    const r = await getAcomp(l.id, 'tok-a');
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ leadId: l.id, status: 'OFERTA_ENVIADA', oferta: { valorCarta: '40000.00', valorLiquido: '31200.00' } });
    for (const p of ['@exemplo.test', '+5511999990000', '52998224725', 'Adm Secreta', 'cpf', 'telefone', 'email', 'administradora', 'publicKey', 'did:privy']) expect(r.texto.toLowerCase(), `vazou ${p}`).not.toContain(p.toLowerCase());
  });
  it('404 UNIFORME: lead de OUTRA pessoa, id inexistente, lead sem dono, pré-KYC e id mal formado dão exatamente o mesmo corpo', async () => {
    const a = await pessoa('a'); await pessoa('b'); const lA = await lead(a.id); const orf = await lead(null);
    const casos = [getAcomp(lA.id, 'tok-b'), getAcomp('id-que-nao-existe', 'tok-a'), getAcomp(orf.id, 'tok-a'), getAcomp(lA.id, 'tok-novato'), getAcomp(orf.id, 'tok-novato'), getAcomp('x'.repeat(200), 'tok-a'), getAcomp('a b/../c', 'tok-a')];
    const rs = await Promise.all(casos);
    for (const r of rs) { expect(r.status).toBe(404); expect(r.texto).toBe(rs[0]!.texto); expect(r.ct).toBe(rs[0]!.ct); }
    expect(rs[0]!.json).toEqual({ error: 'não encontrado' });
    expect(rs[0]!.texto).not.toContain(lA.id);
  });
});
