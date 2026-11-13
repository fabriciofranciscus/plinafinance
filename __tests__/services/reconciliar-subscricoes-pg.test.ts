/**
 * Aceite do reconciliador de reservas órfãs de subscrição (N1), Postgres REAL + Horizon simulado.
 *
 * Desenho (Bento + Estela): a reserva guarda o envelope assinado pelo investidor; `reconciliarSwapsOrfaos()`
 * prova pela conta do INVESTIDOR (situacaoEnvelopeSwap): ENTROU com sucesso → escritura; ENTROU com falha ou S
 * consumida por OUTRA tx → libera; S livre e a rede passou de maxTime + 10 min → libera POR TEMPO e vigia o
 * hash por 24 h (sucesso tardio → escritura); AGUARDANDO → fica; INDETERMINADO → fica para o operador.
 * O gate do NAV (SWAP_EM_VOO) sai quando a reserva é resolvida.
 *
 * Teste de COMPORTAMENTO: semeia linhas (com um envelope real assinado), simula o Horizon e chama o serviço.
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db pnpm vitest run __tests__/services/reconciliar-subscricoes-pg.test.ts
 * Recusa host que não seja local; nunca roda contra o Neon.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    }
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  process.env.OPS_CRON_SECRET = 'segredo-de-teste-do-cron-com-40-caracteres-ok';
  return url;
});

const st = vi.hoisted(() => ({ fetchSupplyDasClasses: vi.fn(), alerta: vi.fn() }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: st.alerta }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.fetchSupplyDasClasses }));

import { Account, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { horizon } from '@/lib/stellar/account';
import { marcarConflitosAlertados } from '@/lib/services/swap-escrituracao';
import { lerSupplyDoNav, NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';

const INV = Keypair.random();
const INV_PK = INV.publicKey();
/** hash da tx da reserva semeada mais recente (cada semente assina um envelope real do investidor). */
let HASH = 'a'.repeat(64);
const SEQ_ENVELOPE = '101';
const MIN = 60_000;
const SECRET = 'segredo-de-teste-do-cron-com-40-caracteres-ok';

// ── Horizon simulado: aceita qualquer encadeamento de builder e responde pelo estado de `chain` ──
const chain = {
  txs: new Map<string, { successful: boolean }>(),
  contaTxs: [] as Array<Record<string, unknown>>,
  ultimoLedger: { sequence: 1000, closed_at: new Date().toISOString() },
  sequenciaConta: '100',
};
const naoAchou = () => Object.assign(new Error('Not Found'), { response: { status: 404, data: { status: 404 } } });
function builder(resolver: () => unknown): never {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'call' ? async () => resolver() : prop === 'then' ? undefined : () => p),
    apply: () => p,
  });
  return p as never;
}
function simularHorizon() {
  vi.spyOn(horizon, 'transactions').mockImplementation((() => ({
    transaction: (h: string) =>
      builder(() => {
        const t = chain.txs.get(h);
        if (!t) throw naoAchou();
        return { hash: h, successful: t.successful, ledger_attr: 900, created_at: new Date().toISOString(), envelope_xdr: '', result_xdr: '', result_meta_xdr: '', paging_token: '1' };
      }),
    forAccount: () => builder(() => ({ records: chain.contaTxs })),
  })) as never);
  vi.spyOn(horizon, 'ledgers').mockImplementation((() => builder(() => ({ records: [chain.ultimoLedger] }))) as never);
  vi.spyOn(horizon, 'loadAccount').mockImplementation((async () => new Account(INV_PK, chain.sequenciaConta)) as never);
}

const supply = (c: string) => ({ circulante: new Prisma.Decimal(c), tesouraria: new Prisma.Decimal('0') }) as never;

type Reserva = { id?: string; maxTimeAtrasoMin: number; sequence?: string; hash?: string };
/** Quote de swap com a XDR reservada e ainda não consumida, com o envelope vencido há `maxTimeAtrasoMin` min. */
async function semearReserva(r: Reserva) {
  await db.investidor.upsert({
    where: { id: 'inv_rec' },
    update: {},
    create: { id: 'inv_rec', nome: 'N', email: 'n@example.com', publicKey: INV_PK, kycAprovado: true },
  });
  const id = r.id ?? 'q_rec';
  // Envelope REAL assinado pelo investidor (a reserva guarda o XDR; o reconciliador prova pela conta dele).
  const maxTimeSec = Math.floor((Date.now() - r.maxTimeAtrasoMin * MIN) / 1000);
  const env = new TransactionBuilder(new Account(INV_PK, '100'), {
    fee: BASE_FEE,
    networkPassphrase,
    timebounds: { minTime: 0, maxTime: maxTimeSec },
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .build();
  env.sign(INV);
  HASH = r.hash ?? env.hash().toString('hex');
  await db.quote.create({
    data: {
      id,
      investidorId: 'inv_rec',
      fromCurrency: 'BRL',
      fromAmount: '100000',
      toCurrency: 'TESOURO',
      toAmount: '99500',
      exchangeRate: '0.995',
      fee: '500',
      expiresAt: new Date(Date.now() - 3600_000),
      navPorTokenNaCotacao: '1.0000',
      plinarfAmount: '99500',
      submitXdrHash: `reserva-${id}`,
      submitTxHash: HASH,
      submitMaxTime: new Date(maxTimeSec * 1000),
      submitXdr: env.toXDR(),
    } as never,
  });
  await db.onRampOrder.create({ data: { id: `ord-${id}`, quoteId: id, investidorId: 'inv_rec', status: 'completed' } });
  return id;
}

async function varrer(deslocaMin = 0) {
  const { reconciliarSwapsOrfaos } = await import('@/lib/services/swap-escrituracao');
  return reconciliarSwapsOrfaos({ agora: Date.now() + deslocaMin * MIN });
}
/** Liberação por TEMPO exige 2 varreduras seguidas, a 2ª ≥ 5 min depois da 1ª (a 1ª só marca). */
async function liberarPorTempo() {
  const a = await varrer(0);
  const b = await varrer(6);
  return { a, b };
}
const estado = (id: string) => db.quote.findUnique({ where: { id }, select: { submitXdrHash: true, consumedAt: true, consumedTxHash: true } });
const navDisponivel = async () => {
  resetNavSupplyCache();
  return lerSupplyDoNav({ fresh: true }).then(() => true, (e) => (e instanceof NavIndisponivelError ? false : Promise.reject(e)));
};

describe.skipIf(!PG)('Varredor de reservas órfãs de subscrição — Postgres real', () => {
  // Deixa o banco LIMPO ao terminar cada caso: uma reserva aberta (swap em voo) fecharia o gate do NAV e
  // quebraria, de forma enganosa, os testes de OUTROS arquivos que usam o mesmo banco.
  afterEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "OnRampOrder", "Quote", "MovimentoFundo", "EventoAudit", "HoldingPLINARF", "Investidor" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    delete process.env.PRECO_TESOURO_REF_BRL;
    delete process.env.PRECO_TESOURO_REF_DATA;
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // F7 (850dae9): referência de preço do TESOURO válida, senão o cron responde alerta:true por referência ausente.
    process.env.PRECO_TESOURO_REF_BRL = '5';
    process.env.PRECO_TESOURO_REF_DATA = new Date().toISOString();
    chain.txs = new Map();
    chain.contaTxs = [];
    chain.ultimoLedger = { sequence: 1000, closed_at: new Date().toISOString() };
    chain.sequenciaConta = '100';
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('1000000'), subordinada: supply('0') });
    st.alerta.mockReset().mockResolvedValue(true);
    simularHorizon();
    await db.$executeRawUnsafe('TRUNCATE "OnRampOrder", "Quote", "MovimentoFundo", "EventoAudit", "HoldingPLINARF", "Investidor" RESTART IDENTITY CASCADE');
  });

  // ── mecânica do teste (passa hoje): prova que o Horizon simulado e a semente funcionam ──
  it('(mecânica) o Horizon simulado responde 404 por hash e o ledger mais recente', async () => {
    HASH = 'a'.repeat(64);
    await expect(horizon.transactions().transaction(HASH).call()).rejects.toMatchObject({ response: { status: 404 } });
    chain.txs.set(HASH, { successful: true });
    await expect(horizon.transactions().transaction(HASH).call()).resolves.toMatchObject({ successful: true });
    const l = (await horizon.ledgers().order('desc').limit(1).call()) as unknown as { records: unknown[] };
    expect(l.records).toHaveLength(1);
  });

  it('tx entrou com SUCESSO: escritura uma vez (quote consumido, saldo, SUBSCRICAO) sem o investidor repetir; idempotente; NAV volta', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 1 });
    chain.txs.set(HASH, { successful: true });
    const r1 = await varrer();
    expect(r1.escriturados).toBe(1);
    const q = await estado(id);
    expect(q?.consumedAt).not.toBeNull();
    expect(q?.consumedTxHash).toBe(HASH);
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(1);
    await varrer();
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(1);
    expect(await navDisponivel()).toBe(true);
  });

  it('o caixa recebe o valor LÍQUIDO (100000 − fee 500) na escrituração do reconciliador', async () => {
    await semearReserva({ maxTimeAtrasoMin: 1 });
    chain.txs.set(HASH, { successful: true });
    await varrer();
    const mov = await db.movimentoFundo.findFirst({ where: { tipo: 'SUBSCRICAO' } });
    expect(new Prisma.Decimal(mov!.valorBrl).toFixed(2)).toBe('99500.00');
  });

  it('tx FALHOU on-chain: libera a reserva (prova positiva) e o NAV volta', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 1 });
    chain.txs.set(HASH, { successful: false });
    const r = await varrer();
    expect(r.liberados).toBe(1);
    expect((await estado(id))?.submitXdrHash).toBeNull();
    expect(await navDisponivel()).toBe(true);
  });

  it('dentro do prazo e fora da chain: aguardando; a reserva fica e o NAV segue fechado', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: -2 });
    const r = await varrer();
    expect(r.aguardando).toBe(1);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    expect(await navDisponivel()).toBe(false);
  });

  it('S livre, venceu há 4 min (dentro da espera de 10 min): AGUARDANDO; a reserva fica e o NAV segue fechado', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 4 });
    const r = await varrer();
    expect(r.aguardando).toBe(1);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    expect(await navDisponivel()).toBe(false);
  });

  it('ABANDONO: o submit falhou, a tx nunca entrou (S livre) e o investidor sumiu; depois da espera a reserva é liberada POR TEMPO e o NAV volta', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const { b } = await liberarPorTempo();
    expect(b.liberados).toBe(1);
    const q = await db.quote.findUnique({ where: { id }, select: { submitXdrHash: true, consumedAt: true, liberadaTxHash: true } as never });
    expect((q as { submitXdrHash: string | null }).submitXdrHash).toBeNull();
    expect((q as { liberadaTxHash: string | null }).liberadaTxHash).toBe(HASH); // entra na vigilância de 24 h
    expect(await navDisponivel()).toBe(true);
  });

  it('sucesso TARDIO: depois de liberada por tempo, se a tx aparece com sucesso dentro de 24 h, a vigilância escritura (uma vez)', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    expect((await liberarPorTempo()).b.liberados).toBe(1);
    chain.txs.set(HASH, { successful: true });
    const r2 = await varrer(7);
    expect(r2.vigiaEscrituradas).toBe(1);
    expect((await estado(id))?.consumedAt).not.toBeNull();
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(1);
    await varrer(); // idempotente
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(1);
  });

  it('vigia: a liberada por tempo cujo hash entra depois, mas o quote já foi consumido por OUTRA tx: conflito, NÃO escritura de novo', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const hashLiberado = HASH;
    expect((await liberarPorTempo()).b.liberados).toBe(1);
    // o investidor refez o swap e a nova tx consumiu o quote (escriturada uma vez)
    await db.quote.update({ where: { id }, data: { consumedAt: new Date(), consumedTxHash: 'f'.repeat(64) } });
    await db.movimentoFundo.create({ data: { tipo: 'SUBSCRICAO', valorBrl: '99500', deltaCaixa: '99500', deltaTokens: '99500', chave: `subscricao:${id}`, quoteId: id, refHash: 'f'.repeat(64) } as never });
    chain.txs.set(hashLiberado, { successful: true }); // a primeira tx aparece depois, com sucesso
    const r = await varrer();
    expect(r.vigiaConflitos).toBe(1);
    expect(r.vigiaEscrituradas).toBe(0);
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(1); // nada escriturado em dobro
    expect((await estado(id))?.consumedTxHash).toBe('f'.repeat(64));
  });

  it('2 varreduras: a 1ª só MARCA (reserva e gate mantidos); a 2ª cedo demais (1 min) também não libera; a 2ª ≥ 5 min libera', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const a = await varrer(0);
    expect(a.aguardando).toBe(1);
    expect(a.liberados).toBe(0);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    expect(await navDisponivel()).toBe(false);
    const marca = await db.quote.findUnique({ where: { id }, select: { livreExpiradaVistaEm: true } as never });
    expect((marca as { livreExpiradaVistaEm: Date | null }).livreExpiradaVistaEm).not.toBeNull();
    const cedo = await varrer(1);
    expect(cedo.liberados).toBe(0);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    const b2 = await varrer(6);
    expect(b2.liberados).toBe(1);
    expect(await navDisponivel()).toBe(true);
  });

  it('a marca da 1ª varredura é APAGADA se o estado deixa de ser livre-expirada (nó atrasado não decide sozinho): reinicia a contagem', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    await varrer(0); // marca
    chain.sequenciaConta = '150'; // a conta passou de S e a consumidora não aparece: INDETERMINADO
    chain.contaTxs = [];
    expect((await varrer(2)).vencidasSemProva).toBe(1);
    const marca = await db.quote.findUnique({ where: { id }, select: { livreExpiradaVistaEm: true } as never });
    expect((marca as { livreExpiradaVistaEm: Date | null }).livreExpiradaVistaEm).toBeNull();
    chain.sequenciaConta = '100'; // volta a parecer livre
    const volta = await varrer(10); // 1ª varredura de novo: marca, NÃO libera mesmo com >5 min desde a primeira marca antiga
    expect(volta.liberados).toBe(0);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    expect((await varrer(17)).liberados).toBe(1);
  });

  it('ENTROU com sucesso e OUTRA tx liberam/escrituram na 1ª varredura (a regra das 2 varreduras vale só para a liberação por tempo)', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    chain.txs.set(HASH, { successful: true });
    const r = await varrer(0);
    expect(r.escriturados).toBe(1);
    expect((await estado(id))?.consumedAt).not.toBeNull();
  });

  it('ALERTA de conflito: um e-mail por quote (dedupe), a rota devolve alerta:true na 1ª vez e NÃO vaza ids nem hashes; depois alerta:false', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const hashLiberado = HASH;
    await liberarPorTempo();
    await db.quote.update({ where: { id }, data: { consumedAt: new Date(), consumedTxHash: 'f'.repeat(64) } });
    chain.txs.set(hashLiberado, { successful: true });
    const r1 = await chamarRota({ authorization: `Bearer ${SECRET}` });
    const t1 = await r1.text();
    expect(JSON.parse(t1)).toMatchObject({ vigiaConflitos: 1, alerta: true, alertaEnviado: true });
    expect(t1).not.toContain(id);
    expect(t1).not.toMatch(/[0-9a-f]{64}/);
    expect(st.alerta).toHaveBeenCalledTimes(1);
    const corpoEmail = JSON.stringify(st.alerta.mock.calls[0][0]);
    expect(corpoEmail).toContain(id); // o e-mail leva o id interno do quote
    expect(corpoEmail).not.toMatch(/[0-9a-f]{64}|SECRET|@|G[A-Z2-7]{55}/);
    const r2 = await chamarRota({ authorization: `Bearer ${SECRET}` });
    expect(JSON.parse(await r2.text())).toMatchObject({ alerta: false, alertaEnviado: false });
    expect(st.alerta).toHaveBeenCalledTimes(1); // dedupe: nenhuma segunda mensagem
  });

  it('alerta sem SMTP (no-op): o conflito é contado e a rota responde alertaEnviado:false, sem erro', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const h = HASH;
    await liberarPorTempo();
    await db.quote.update({ where: { id }, data: { consumedAt: new Date(), consumedTxHash: 'e'.repeat(64) } });
    chain.txs.set(h, { successful: true });
    st.alerta.mockResolvedValue(false);
    const r = await chamarRota({ authorization: `Bearer ${SECRET}` });
    expect(r.status).toBe(200);
    expect(JSON.parse(await r.text())).toMatchObject({ alerta: true, alertaEnviado: false });
  });

  async function semearConflito(hashChar: string) {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    await liberarPorTempo();
    await db.quote.update({ where: { id }, data: { consumedAt: new Date(), consumedTxHash: hashChar.repeat(64) } });
    chain.txs.set(HASH, { successful: true });
    return id;
  }
  const marcaDe = async (id: string) =>
    (await db.quote.findUnique({ where: { id }, select: { conflitoAlertadoEm: true } }))?.conflitoAlertadoEm ?? null;

  it('ALERTA: SMTP falha -> a marca NAO e gravada -> a proxima varredura alerta de novo; entregue -> marca gravada e para (alerta 2x, marca 1x)', async () => {
    const id = await semearConflito('d');
    st.alerta.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r1 = JSON.parse(await (await chamarRota({ authorization: `Bearer ${SECRET}` })).text());
    expect(r1).toMatchObject({ vigiaConflitos: 1, alerta: true, alertaEnviado: false });
    expect(await marcaDe(id)).toBeNull(); // e-mail nao saiu: sem marca
    const r2 = JSON.parse(await (await chamarRota({ authorization: `Bearer ${SECRET}` })).text());
    expect(r2).toMatchObject({ vigiaConflitos: 1, alerta: true, alertaEnviado: true }); // alerta de novo
    expect(await marcaDe(id)).not.toBeNull(); // entregue: marca gravada
    const r3 = JSON.parse(await (await chamarRota({ authorization: `Bearer ${SECRET}` })).text());
    expect(r3).toMatchObject({ alerta: false, alertaEnviado: false });
    expect(st.alerta).toHaveBeenCalledTimes(2); // 3 varreduras, 2 e-mails, nenhum apos a entrega
    expect(await db.movimentoFundo.count({ where: { tipo: 'SUBSCRICAO' } })).toBe(0); // nada escriturado
  });

  it('ALERTA: se o envio LANCA excecao, a rota responde 500 generico, a marca NAO e gravada e a proxima varredura alerta de novo', async () => {
    const id = await semearConflito('c');
    st.alerta.mockRejectedValueOnce(new Error('smtp caiu')).mockResolvedValueOnce(true);
    const r1 = await chamarRota({ authorization: `Bearer ${SECRET}` });
    const t1 = await r1.text();
    expect(r1.status).toBe(500);
    expect(t1).not.toContain('smtp');
    expect(await marcaDe(id)).toBeNull();
    const r2 = JSON.parse(await (await chamarRota({ authorization: `Bearer ${SECRET}` })).text());
    expect(r2).toMatchObject({ alerta: true, alertaEnviado: true });
    expect(await marcaDe(id)).not.toBeNull();
    expect(st.alerta).toHaveBeenCalledTimes(2);
  });

  it('reconciliador NUNCA grava a marca: devolve o conflito (e os ids) a cada varredura ate a rota marcar', async () => {
    const id = await semearConflito('b');
    for (let i = 0; i < 3; i++) {
      const r = await varrer();
      expect(r.vigiaConflitos).toBe(1);
      expect(r.conflitoQuoteIds).toEqual([id]);
      expect(await marcaDe(id)).toBeNull();
    }
    expect(st.alerta).not.toHaveBeenCalled(); // quem envia e a rota, nao o reconciliador
  });

  it('marcarConflitosAlertados: grava so nos nao marcados (nao reescreve a data), lista vazia = no-op', async () => {
    const id = await semearConflito('a');
    await marcarConflitosAlertados([]); // no-op
    expect(await marcaDe(id)).toBeNull();
    const t0 = Date.now();
    await marcarConflitosAlertados([id], t0);
    expect((await marcaDe(id))?.getTime()).toBe(t0);
    await marcarConflitosAlertados([id], t0 + 3_600_000); // ja marcado: mantem a primeira data
    expect((await marcaDe(id))?.getTime()).toBe(t0);
    await marcarConflitosAlertados(['inexistente']); // id desconhecido nao explode
    const r = await varrer();
    expect(r.vigiaConflitos).toBe(0); // marcado: a varredura nao reporta de novo
    expect(r.conflitoQuoteIds).toEqual([]);
  });

  it('S consumida por OUTRA tx do investidor: libera sem esperar a margem e o NAV volta', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 2 });
    chain.sequenciaConta = SEQ_ENVELOPE; // a conta já está em S
    chain.contaTxs = [{ hash: 'f'.repeat(64), successful: true, source_account: INV_PK, source_account_sequence: SEQ_ENVELOPE, ledger_attr: 950, paging_token: '1' }];
    const r = await varrer();
    expect(r.liberados).toBe(1);
    expect((await estado(id))?.submitXdrHash).toBeNull();
    expect(await navDisponivel()).toBe(true);
  });

  it('conta passou de S mas a consumidora não aparece: INDETERMINADO (vencidasSemProva); a reserva fica para o operador', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    chain.sequenciaConta = '150';
    chain.contaTxs = [];
    const r = await varrer();
    expect(r.vencidasSemProva).toBe(1);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
  });

  it('cron (c37c30a): swap órfão SEM prova (INDETERMINADO) marca alerta:true (o job falha) e a reserva segue para o operador; sem órfã sem prova volta a alerta:false', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    chain.sequenciaConta = '150'; // a conta passou de S e a consumidora não aparece
    chain.contaTxs = [];
    const r = await chamarRota({ authorization: `Bearer ${SECRET}` });
    const j = JSON.parse(await r.text());
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ vencidasSemProva: 1, alerta: true });
    expect(st.alerta).not.toHaveBeenCalled(); // não é conflito de vigia: sem e-mail, o job é que falha
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
    await db.quote.update({ where: { id }, data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null } });
    expect(JSON.parse(await (await chamarRota({ authorization: `Bearer ${SECRET}` })).text())).toMatchObject({ vencidasSemProva: 0, alerta: false });
  });

  it('reserva sem hash nem XDR (anterior às colunas): semHash, nada é tocado', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 30 });
    await db.$executeRawUnsafe(`UPDATE "Quote" SET "submitTxHash" = NULL, "submitXdr" = NULL WHERE id = '${id}'`);
    const r = await varrer();
    expect(r.semHash).toBe(1);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
  });

  it('Horizon fora: conta erro e mantém a reserva (não escritura nem libera às cegas)', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    vi.spyOn(horizon, 'transactions').mockImplementation((() => {
      throw Object.assign(new Error('boom'), { response: { status: 503 } });
    }) as never);
    const r = await varrer();
    expect(r.erros).toBe(1);
    const q = await estado(id);
    expect(q?.submitXdrHash).not.toBeNull();
    expect(q?.consumedAt).toBeNull();
  });

  // ── rota agendada (Bearer OPS_CRON_SECRET) ──
  const chamarRota = async (headers: Record<string, string>) => {
    const { GET } = await import('@/app/api/ops/reconciliar-subscricoes/route');
    return GET(new Request('http://x/api/ops/reconciliar-subscricoes', { headers }));
  };

  it('rota ops: secret FRACO configurado (< 32 caracteres) → 404 mesmo com o Bearer igual (a rota some)', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    const original = process.env.OPS_CRON_SECRET;
    try {
      process.env.OPS_CRON_SECRET = 'abcd';
      expect((await chamarRota({ authorization: 'Bearer abcd' })).status).toBe(404);
      process.env.OPS_CRON_SECRET = 'x'.repeat(31);
      expect((await chamarRota({ authorization: `Bearer ${'x'.repeat(31)}` })).status).toBe(404);
      process.env.OPS_CRON_SECRET = 'x'.repeat(32);
      expect((await chamarRota({ authorization: `Bearer ${'x'.repeat(32)}` })).status).toBe(200);
    } finally {
      process.env.OPS_CRON_SECRET = original;
    }
    expect(id).toBeTruthy();
  });

  it('vigia em LOTE: com mais hashes liberados que o lote, a resposta indica vigiaRestantes e o rodízio avança (nunca consultadas primeiro)', async () => {
    const { VIGIA_LOTE } = await import('@/lib/services/swap-escrituracao');
    await db.investidor.create({ data: { id: 'inv_lote', nome: 'L', email: 'l@example.com', publicKey: 'G'.padEnd(56, 'C'), kycAprovado: true } });
    const total = VIGIA_LOTE + 5;
    for (let i = 0; i < total; i++) {
      await db.quote.create({
        data: {
          id: `lote_${i}`, investidorId: 'inv_lote', fromCurrency: 'BRL', fromAmount: '1000', toCurrency: 'TESOURO', toAmount: '995',
          exchangeRate: '0.995', fee: '5', expiresAt: new Date(Date.now() - 3600_000), navPorTokenNaCotacao: '1', plinarfAmount: '995',
          liberadaTxHash: i.toString(16).padStart(64, '0'), liberadaPorTempoEm: new Date(Date.now() - 60_000 * (total - i)),
        } as never,
      });
    }
    const r1 = await varrer(0);
    expect(r1.vigiaRestantes).toBe(5);
    const carimbadas1 = await db.quote.count({ where: { vigiaConsultadaEm: { not: null } } as never });
    expect(carimbadas1).toBe(VIGIA_LOTE);
    const r2 = await varrer(1);
    expect(r2.vigiaRestantes).toBe(5);
    // depois da 2ª execução as 5 que faltavam já foram consultadas (as nunca consultadas vêm primeiro)
    expect(await db.quote.count({ where: { vigiaConsultadaEm: { not: null } } as never })).toBe(total);
  });

  it('rota ops: 404 sem Bearer, com secret errado e com prefixo errado; nada é reconciliado nessas chamadas', async () => {
    const id = await semearReserva({ maxTimeAtrasoMin: 60 });
    expect((await chamarRota({})).status).toBe(404);
    expect((await chamarRota({ authorization: 'Bearer errado' })).status).toBe(404);
    expect((await chamarRota({ authorization: SECRET })).status).toBe(404);
    expect((await estado(id))?.submitXdrHash).not.toBeNull();
  });

  it('rota ops: com o secret certo reconcilia e responde SÓ contagens (sem PII, sem chaves, sem hashes)', async () => {
    const idr = await semearReserva({ maxTimeAtrasoMin: 60 });
    await db.$executeRawUnsafe(`UPDATE "Quote" SET "livreExpiradaVistaEm" = now() - interval '6 minutes' WHERE id = '${idr}'`);
    const r = await chamarRota({ authorization: `Bearer ${SECRET}` });
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(JSON.parse(texto)).toMatchObject({ liberados: 1, alerta: false, alertaEnviado: false });
    expect(texto).not.toMatch(/@|G[A-Z2-7]{55}|[0-9a-f]{64}/);
  });

  // ── mitigação de disponibilidade: investidor com órfã aberta não cria swap novo ──
  it('investidor com swap em conferência (reserva sem consumedAt) NÃO inicia outro: 409 SWAP_EM_CONFERENCIA; outro investidor e o quote consumido não são afetados', async () => {
    await semearReserva({ maxTimeAtrasoMin: 60 });
    const { assertSemSwapEmConferencia } = await import('@/lib/services/swap-orfao');
    await expect(assertSemSwapEmConferencia('inv_rec')).rejects.toMatchObject({ code: 'SWAP_EM_CONFERENCIA', status: 409 });
    await expect(assertSemSwapEmConferencia('outro_investidor')).resolves.toBeUndefined();
    await expect(assertSemSwapEmConferencia('inv_rec', { ignorarQuoteId: 'q_rec' })).resolves.toBeUndefined();
    await liberarPorTempo(); // liberada por tempo: o investidor volta a poder operar
    await expect(assertSemSwapEmConferencia('inv_rec')).resolves.toBeUndefined();
  });
});
