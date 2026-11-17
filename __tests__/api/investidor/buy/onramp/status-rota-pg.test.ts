/**
 * onramp/status — a rota inteira contra o Postgres REAL: a trava por ordem vale ENTRE INSTÂNCIAS (duas cópias do módulo da rota, cada
 * uma com o seu cache de 5 s) e a conclusão grava UMA transição e UM evento de auditoria. Só a Etherfuse e a sessão são simuladas.
 * Só roda com um Postgres descartável em TEST_PG_URL (localhost, migrations aplicadas); sem a variável é pulado.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
const st = vi.hoisted(() => ({ consultas: 0, atrasoMs: 60, remoto: { status: 'processing', stellarTxHash: null as string | null, stellarClaimableBalanceId: null as string | null }, aoConsultar: null as null | (() => Promise<void>), sempreGanha: false }));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return { ...actual, requireInvestidor: vi.fn().mockResolvedValue({ privyId: 'did:privy:t', investidorId: 'inv_t', publicKey: 'GABC', email: 'x@y.z', etherfuseCustomerId: 'cust_1' }) };
});
vi.mock('@/lib/anchors/etherfuse', () => ({
  EtherfuseClient: class {
    async getOnRampTransaction() {
      st.consultas += 1;
      await new Promise((r) => setTimeout(r, st.atrasoMs));
      if (st.aoConsultar) await st.aoConsultar();
      return { ...st.remoto };
    }
  },
}));
vi.mock('@/lib/rate-limit/config', () => ({ onrampStatusLimiter: { consume: async () => true, reset: () => undefined } }));
vi.mock('@/lib/services/onramp-status-reserva', async (orig) => {
  const real = await orig<typeof import('@/lib/services/onramp-status-reserva')>();
  return { ...real, reservarConsultaDeStatus: (id: string) => (st.sempreGanha ? Promise.resolve(true) : real.reservarConsultaDeStatus(id)) };
});

process.env.ETHERFUSE_API_KEY = 'test';

import { db } from '@/lib/db';

type Rota = { GET: (r: Request) => Promise<Response> };
const novaInstancia = async (): Promise<Rota> => {
  vi.resetModules(); // módulo novo = cache de 5 s PRÓPRIO (como uma instância serverless nova)
  return (await import('@/app/api/investidor/buy/onramp/status/route')) as unknown as Rota;
};
const req = (id: string) => new Request(`http://x/status?orderId=${id}`, { method: 'GET' });
const mkOrdem = async (id: string, over: Record<string, unknown> = {}) => {
  await db.quote.create({ data: { id: `q_${id}`, investidorId: 'inv_t', fromCurrency: 'BRL', fromAmount: '10', toCurrency: 'TESOURO', toAmount: '8', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 60_000) } });
  await db.onRampOrder.create({ data: { id, quoteId: `q_${id}`, investidorId: 'inv_t', status: 'processing', paymentInstructionsJson: { __mock: false }, ...over } as never });
};

describe.skipIf(!PG)('onramp/status — rota contra o Postgres real', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    st.consultas = 0; st.sempreGanha = false; st.aoConsultar = null; st.remoto = { status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: null };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db.$executeRawUnsafe('TRUNCATE "EventoAudit","OnRampOrder","Quote","Investidor" RESTART IDENTITY CASCADE');
    await db.investidor.create({ data: { id: 'inv_t', nome: 'Inv', email: 'inv@exemplo.test', publicKey: 'G' + 'A'.repeat(55), privyId: 'did:privy:t' } });
  });

  it('ENTRE INSTÂNCIAS: 10 requisições simultâneas da mesma ordem (2 instâncias, 2 caches) → UMA consulta à Etherfuse; todas respondem 200', async () => {
    await mkOrdem('o1');
    const [A, B] = [await novaInstancia(), await novaInstancia()];
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? A : B).GET(req('o1'))));
    expect(r.map((x) => x.status)).toEqual(Array(10).fill(200));
    expect(st.consultas).toBe(1);
  });

  it('o perdedor devolve o estado guardado no banco (mesmo formato), sem 429', async () => {
    await mkOrdem('o1');
    const [A, B] = [await novaInstancia(), await novaInstancia()];
    const ganhador = await A.GET(req('o1'));
    const perdedor = await B.GET(req('o1')); // dentro da janela de N s no relógio do banco
    expect(ganhador.status).toBe(200);
    expect(perdedor.status).toBe(200);
    expect(st.consultas).toBe(1);
    expect(Object.keys((await perdedor.json()).data).sort()).toEqual(Object.keys((await ganhador.json()).data).sort());
  });

  it('a trava não mexe em atualizadoEm (o "desde quando espera" do A-09 segue o de antes)', async () => {
    await mkOrdem('o1');
    const antes = (await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm;
    await new Promise((r) => setTimeout(r, 30));
    const A = await novaInstancia();
    await A.GET(req('o1')); // reserva + consulta, remoto igual ao do banco: sem escrita de estado
    const depois = (await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm;
    expect(depois.getTime()).toBe(antes.getTime());
    expect((await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).statusConsultadoEm).not.toBeNull();
  });

  it('CONCLUSÃO concorrente (a trava forçada a deixar todos passarem): 1 transição, settledAt gravado uma vez e UM evento ONRAMP_LIQUIDADA', async () => {
    await mkOrdem('o1');
    st.sempreGanha = true;
    st.remoto = { status: 'completed', stellarTxHash: 'tx_done', stellarClaimableBalanceId: 'cb_1' };
    const [A, B] = [await novaInstancia(), await novaInstancia()];
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? A : B).GET(req('o1'))));
    expect(r.map((x) => x.status)).toEqual(Array(6).fill(200));
    expect(st.consultas).toBe(6);
    const o = await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } });
    expect(o).toMatchObject({ status: 'completed', stellarTxHash: 'tx_done', stellarClaimableBalanceId: 'cb_1' });
    expect(o.settledAt).not.toBeNull();
    expect(await db.eventoAudit.count({ where: { acao: 'ONRAMP_LIQUIDADA' } })).toBe(1);
  });

  it('uma leitura ATRASADA (remoto "processing") nunca desfaz um estado terminal gravado por outra consulta no meio', async () => {
    await mkOrdem('o1');
    st.sempreGanha = true;
    st.remoto = { status: 'processing', stellarTxHash: null, stellarClaimableBalanceId: 'cb_velho' };
    st.aoConsultar = async () => { // enquanto esta consulta espera o anchor, outra liquida a ordem
      await db.onRampOrder.update({ where: { id: 'o1' }, data: { status: 'completed', settledAt: new Date(), stellarTxHash: 'tx_done' } });
    };
    const A = await novaInstancia();
    const r = await A.GET(req('o1'));
    expect(r.status).toBe(200);
    const o = await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } });
    expect(o).toMatchObject({ status: 'completed', stellarTxHash: 'tx_done' });
    expect(o.stellarClaimableBalanceId).toBeNull(); // a escrita atrasada foi recusada
  });

  // A-09 (aviso de espera visível) × trava: o "desde" e o "atrasada" vêm de atualizadoEm + status e têm de sair em TODA resposta,
  // inclusive a que a trava devolve do banco (o investidor que mais consulta é justamente o que espera).
  it('A-09 + trava: ordem processing esperando há 5 min tem desde/atrasada/limiteSegundos tanto na resposta que CONSULTOU quanto na que a trava devolveu do banco', async () => {
    await mkOrdem('o1', { stellarClaimableBalanceId: null });
    await db.$executeRaw`UPDATE "OnRampOrder" SET "atualizadoEm" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE id = 'o1'`;
    const velha = (await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm;
    const [A, B] = [await novaInstancia(), await novaInstancia()];
    const ganhou = await (await A.GET(req('o1'))).json();
    const perdeu = await (await B.GET(req('o1'))).json(); // a trava: não consulta, devolve o estado do banco
    expect(st.consultas).toBe(1);
    for (const d of [ganhou.data, perdeu.data]) {
      expect(d).toMatchObject({ status: 'processing', atrasada: true, limiteSegundos: 180, desde: velha.toISOString() });
    }
    // e a trava não moveu o "desde": atualizadoEm continua o da espera
    expect((await db.onRampOrder.findUniqueOrThrow({ where: { id: 'o1' } })).atualizadoEm.getTime()).toBe(velha.getTime());
  });
});
