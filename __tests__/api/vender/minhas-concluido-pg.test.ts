/**
 * QA (Vera) — item 19 com Postgres REAL, pelas rotas: GET /api/vender/minhas (`concluido` só com COTA_INCORPORADA). Mock só do verificador do Privy (tok-<x> → did:privy:<x>).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) { if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('local apenas'); process.env.DATABASE_URL = url; process.env.DIRECT_URL = url; }
  return url;
});
vi.mock('@/lib/wallet/privy', async (orig) => ({ ...(await orig<typeof import('@/lib/wallet/privy')>()), verifyPrivyTokenLite: async (t: string) => { if (!t.startsWith('tok-')) throw new Error('x'); return { userId: `did:privy:${t.slice(4)}`, email: `${t.slice(4)}@exemplo.test` }; } }));
import { db } from '@/lib/db';
import { GET as minhas } from '@/app/api/vender/minhas/route';

const LIMPAR = 'TRUNCATE "Cessao","Oferta","EventoAudit","LeadVendedor","Pessoa" RESTART IDENTITY CASCADE';
let ip = 0, n = 0;
const hdr = (token?: string) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': `10.19.${Math.floor(++ip / 250)}.${ip % 250}` });
const getMinhas = async (token: string) => { const r = await minhas(new Request('http://x/api/vender/minhas', { headers: hdr(token) })); const t = await r.text(); return { status: r.status, json: JSON.parse(t) }; };
const pessoa = (x: string) => db.pessoa.create({ data: { id: `p${x}`, privyId: `did:privy:${x}`, email: `${x}@exemplo.test`, nome: `Nome ${x}`, publicKey: `G${x}`.padEnd(56, 'A').slice(0, 56), cpfNormalizado: '52998224725', kycAprovado: true } });
const lead = async (pessoaId: string | null, status = 'OFERTA_ENVIADA') => { n += 1; const l = await db.leadVendedor.create({ data: { nome: `Fulano Secreto ${n}`, email: `fulano.secreto${n}@exemplo.test`, telefone: '+5511999990000', pessoaId, status } as never }); await db.oferta.create({ data: { leadVendedorId: l.id, tipoBem: 'IMOVEL', valorCarta: '40000', administradora: 'Adm Secreta', desagioAquisicao: '0.22', valorLiquidoVendedor: '31200', validade: new Date(Date.now() + 86_400_000), status: 'ENVIADA' } as never }); return l; };

describe.skipIf(!PG)('/api/vender/minhas — concluido só com a cota', () => {
  beforeEach(async () => { await db.$executeRawUnsafe(LIMPAR); });
  afterAll(async () => { await db.$executeRawUnsafe(LIMPAR); await db.$disconnect(); });

  it('/api/vender/minhas: concluido só com COTA_INCORPORADA (PIX_EXECUTADO = false; PERDIDO = encerrado, não concluído)', async () => {
    const a = await pessoa('a');
    const base = Date.UTC(2026, 10, 15, 12, 0);
    for (const [i, s] of (['NOVO', 'OFERTA_ACEITA', 'CESSAO_ASSINADA', 'PIX_EXECUTADO', 'COTA_INCORPORADA', 'PERDIDO'] as const).entries()) {
      const l = await lead(a.id, s); await db.leadVendedor.update({ where: { id: l.id }, data: { criadoEm: new Date(base + i * 60_000) } });
    }
    const r = await getMinhas('tok-a'); expect(r.status).toBe(200);
    const por: Record<string, any> = Object.fromEntries(r.json.solicitacoes.map((s: any) => [s.status, s]));
    expect(por.PIX_EXECUTADO.concluido).toBe(false); expect(por.COTA_INCORPORADA.concluido).toBe(true);
    for (const s of ['NOVO', 'OFERTA_ACEITA', 'CESSAO_ASSINADA']) expect(por[s].concluido, s).toBe(false);
    expect(por.PERDIDO).toMatchObject({ encerrado: true, concluido: false });
  });
});
