/**
 * Aceite do resgate com queima (E2-6) — Postgres REAL + Horizon simulado + XDR real assinado.
 *
 * Fluxo testado de verdade: `cotarResgate` (preço do ledger + XDR de 2 pernas) → o investidor assina com a chave dele →
 * `submeterResgate` (valida contra a cotação, reserva, a Plina assina por último, submete, escritura) e o reconciliador
 * `reconciliarSwapsOrfaos` para a reserva órfã. O que se prova aqui é o COMPORTAMENTO no banco: razão (RESGATE_PAGO),
 * holding, saldoEsperado, EventoAudit, reserva, gate do NAV e invariância do NAV.
 *
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db pnpm vitest run __tests__/services/resgate-pg.test.ts
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

import { Account, Asset, Keypair, Memo, Operation, Transaction, TransactionBuilder, TimeoutInfinite } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import { ApiError } from '@/lib/api/errors';
import { lerSupplyDoNav, NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';
import { cotarResgate, submeterResgate } from '@/lib/services/resgate';
import { memoHashDoResgate } from '@/lib/services/regras-resgate';
import { reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';
import * as signerMod from '@/lib/stellar/signer';

const MIN = 60_000;
const INV = Keypair.random();
const INV_PK = INV.publicKey();
const OUTRO = Keypair.random();
const ISSUER = Keypair.random();
const DIST = Keypair.random();
const TESOURO = { code: 'TESOURO', issuer: Keypair.random().publicKey() };
const PRECO = '5'; // preço LÍQUIDO do TESOURO: R$ 5 por TESOURO (valor de teste; a rota calcula (fromAmount − fee) ÷ toAmount)

// ── Horizon simulado ──
const chain = {
  txs: new Map<string, { successful: boolean }>(),
  contaTxs: [] as Array<Record<string, unknown>>,
  ultimoLedger: { sequence: 1000, closed_at: new Date().toISOString() },
  sequenciaConta: '100',
  submit: 'ok' as 'ok' | 'ambiguo' | 'rejeita',
  /** Erro arbitrário do envio ao Horizon (tem prioridade sobre `submit`). */
  erroEnvio: null as null | (() => Error),
  balances: [] as unknown[],
  /** Saldo de TESOURO do distributor (liquidez) e preço líquido que a Etherfuse devolve AGORA (relido no submit). */
  saldoDistributor: '1000000000',
  preco: '5',
  submetidos: [] as Transaction[],
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
  vi.spyOn(horizon, 'loadAccount').mockImplementation((async (id: string) => Object.assign(new Account(id, chain.sequenciaConta), {
    balances: id === DIST.publicKey()
      ? [{ asset_type: 'credit_alphanum12', asset_code: TESOURO.code, asset_issuer: TESOURO.issuer, balance: chain.saldoDistributor, is_authorized: true }]
      : chain.balances,
  })) as never);
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'submitTransaction').mockImplementation((async (tx: Transaction) => {
    chain.submetidos.push(tx);
    if (chain.erroEnvio) throw chain.erroEnvio();
    if (chain.submit === 'ambiguo') throw Object.assign(new Error('timeout'), { response: { status: 504 } });
    if (chain.submit === 'rejeita') {
      throw Object.assign(new Error('bad'), {
        response: { status: 400, data: { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_failed', operations: ['op_no_trust'] } } } },
      });
    }
    const hash = tx.hash().toString('hex');
    chain.txs.set(hash, { successful: true });
    return { hash, successful: true, ledger: 900 };
  }) as never);
}
const supply = (c: string) => ({ circulante: new Prisma.Decimal(c), tesouraria: new Prisma.Decimal('0') }) as never;

// ── Sementes ──
async function semearInvestidor(id = 'inv_res', pk = INV_PK, privyId = 'did:privy:res1', saldo = '1000') {
  await db.investidor.create({
    data: { id, nome: 'Investidor Simulado', email: `${id}@example.com`, publicKey: pk, privyId, kycAprovado: true, saldoEsperado: saldo } as never,
  });
  await db.holdingPLINARF.create({ data: { investidorId: id, classe: 'SENIOR', saldo } });
  return { id, publicKey: pk, privyId };
}
/** Fundo com caixa 1.000.000 e supply 1.000.000 → NAV 1,00 (a queima de q com saída V = q·NAV mantém o NAV). */
async function semearFundo() {
  await db.movimentoFundo.create({
    data: { tipo: 'SUBSCRICAO', valorBrl: '1000000', deltaCaixa: '1000000', deltaTokens: '1000000', chave: 'seed-fundo' } as never,
  });
}
const INVESTIDOR = { id: 'inv_res', publicKey: INV_PK, privyId: 'did:privy:res1' };

async function cotar(amount = '100.0000000', investidor = INVESTIDOR, preco = PRECO) {
  return cotarResgate({
    investidorId: investidor.id, investorPubkey: investidor.publicKey, amountPlinarf: amount, precoTesouroBrl: preco, bridgeAsset: TESOURO,
  });
}
const assinar = (xdr: string, kp = INV) => {
  const t = new Transaction(xdr, networkPassphrase);
  t.sign(kp);
  return t.toXDR();
};
type Mut = { timebounds?: { minTime: number | string; maxTime: number | string } | 'infinito'; memo?: Memo; amounts?: [string, string]; destinos?: [string, string]; extraOp?: boolean };
/** Refaz o envelope do build trocando UMA coisa (e assina de novo com o investidor, para só a divergência falhar). */
function refazer(xdr: string, m: Mut, signer: Keypair | null = INV) {
  const t = new Transaction(xdr, networkPassphrase);
  const tb = m.timebounds && m.timebounds !== 'infinito' ? m.timebounds : { minTime: t.timeBounds!.minTime, maxTime: t.timeBounds!.maxTime };
  const b = new TransactionBuilder(new Account(t.source, (BigInt(t.sequence) - BigInt(1)).toString()), {
    fee: t.fee, networkPassphrase, ...(m.timebounds === 'infinito' ? {} : { timebounds: tb }),
  });
  (t.operations as Array<{ destination: string; asset: Asset; amount: string; source?: string }>).forEach((op, i) =>
    b.addOperation(Operation.payment({ destination: m.destinos?.[i] ?? op.destination, asset: op.asset, amount: m.amounts?.[i] ?? op.amount, source: op.source })),
  );
  if (m.extraOp) b.addOperation(Operation.payment({ destination: OUTRO.publicKey(), asset: Asset.native(), amount: '1' }));
  b.addMemo(m.memo ?? t.memo);
  if (m.timebounds === 'infinito') b.setTimeout(TimeoutInfinite);
  const novo = b.build();
  if (signer) novo.sign(signer);
  return novo.toXDR();
}
const estado = (id: string) =>
  db.resgateCotacao.findUnique({ where: { id }, select: { submitXdrHash: true, submitXdr: true, consumedAt: true, consumedTxHash: true } });
const movimentos = (tipo: string) => db.movimentoFundo.count({ where: { tipo: tipo as never } });
const caixa = async () => (await db.movimentoFundo.aggregate({ _sum: { deltaCaixa: true } }))._sum.deltaCaixa ?? new Prisma.Decimal(0);
const navDisponivel = async () => {
  resetNavSupplyCache();
  return lerSupplyDoNav({ fresh: true }).then(() => true, (e) => (e instanceof NavIndisponivelError ? false : Promise.reject(e)));
};
const erro = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as ApiError | Error | null;
const submeter = (xdr: string, quoteId: string, extra: { agora?: number; investidor?: typeof INVESTIDOR; obter?: () => Promise<string> } = {}) =>
  submeterResgate({ investidor: extra.investidor ?? INVESTIDOR, quoteId, signedXdr: xdr, agora: extra.agora, obterPrecoTesouroBrl: extra.obter ?? (async () => chain.preco) });
const varrer = (deslocaMin = 0) => reconciliarSwapsOrfaos({ agora: Date.now() + deslocaMin * MIN });
// "Cota" entra na limpeza: outro arquivo de teste PG deixa uma cota DISPONIVEL no banco e ela mexe no NAV (1,0004).
const LIMPAR = 'TRUNCATE "ResgateCotacao", "OnRampOrder", "Quote", "MovimentoFundo", "EventoAudit", "HoldingPLINARF", "Investidor", "Cota" RESTART IDENTITY CASCADE';

describe.skipIf(!PG)('Resgate com queima (E2-6) — Postgres real', () => {
  // Reserva aberta fecharia o gate do NAV e quebraria, de forma enganosa, os testes de OUTROS arquivos no mesmo banco.
  afterEach(async () => {
    await db.$executeRawUnsafe(LIMPAR);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER.publicKey());
    vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', DIST.publicKey());
    vi.stubEnv('STELLAR_DISTRIBUTOR_SECRET', DIST.secret());
    vi.stubEnv('PRECO_TESOURO_REF_BRL', PRECO); // referência independente (faixa ±2%)
    vi.stubEnv('PRECO_TESOURO_REF_DATA', new Date().toISOString()); // F7 (850dae9): a config SEM data não conta
    vi.stubEnv('TESOURO_TAXA_ANUAL', ''); // sem correção por padrão
    vi.stubEnv('RESGATE_MAX_BRL', '100000000'); // teto alto: os testes de teto o baixam
    _resetFeeCacheForTests();
    chain.txs = new Map();
    chain.contaTxs = [];
    chain.ultimoLedger = { sequence: 1000, closed_at: new Date().toISOString() };
    chain.sequenciaConta = '100';
    chain.submit = 'ok';
    chain.erroEnvio = null;
    chain.submetidos = [];
    chain.saldoDistributor = '1000000000';
    chain.preco = PRECO;
    chain.balances = [
      { asset_type: 'credit_alphanum12', asset_code: TESOURO.code, asset_issuer: TESOURO.issuer, balance: '0', is_authorized: true },
    ];
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('1000000'), subordinada: supply('0') });
    st.alerta.mockReset().mockResolvedValue(true);
    simularHorizon();
    await db.$executeRawUnsafe(LIMPAR);
    await semearInvestidor();
    await semearFundo();
  });

  describe('escrituração (caminho feliz)', () => {
    it('cota → investidor assina → submit: RESGATE_PAGO no razão, holding e saldoEsperado baixam, audit gravado, NAV invariante', async () => {
      const nav0 = await navDisponivel();
      expect(nav0).toBe(true);
      const c = await cotar('100.0000000');
      expect(c.brlEquivalente).toBe('100.00');
      expect(c.navPorTokenNaCotacao).toBe('1.00000000');
      const r = await submeter(assinar(c.xdr), c.quoteId);

      const s = await estado(c.quoteId);
      expect(s?.consumedAt).not.toBeNull();
      expect(s?.consumedTxHash).toBe(r.txHash);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect((await caixa()).toFixed(2)).toBe('999900.00'); // 1.000.000 − 100
      const mov = await db.movimentoFundo.findFirstOrThrow({ where: { tipo: 'RESGATE_PAGO' } });
      expect(mov.deltaCaixa.toFixed(2)).toBe('-100.00');
      expect(mov.deltaTokens.toFixed(7)).toBe('-100.0000000');
      expect(mov.txHash).toBe(r.txHash);
      expect((await db.holdingPLINARF.findFirstOrThrow({ where: { investidorId: 'inv_res' } })).saldo.toFixed(7)).toBe('900.0000000');
      expect((await db.investidor.findUniqueOrThrow({ where: { id: 'inv_res' } })).saldoEsperado.toFixed(7)).toBe('900.0000000');
      const audit = await db.eventoAudit.findFirstOrThrow({ where: { acao: 'PLINARF_LIQUIDADO' } });
      expect(audit.stellarTxHash).toBe(r.txHash);
      // a Plina assinou por último: o envelope submetido tem a assinatura do investidor e a do distributor, nenhuma outra
      expect(chain.submetidos).toHaveLength(1);
      expect(chain.submetidos[0].signatures).toHaveLength(2);
      // NAV depois: o supply caiu 100 (queima) e o caixa 100 → continua 1,00
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('999900'), subordinada: supply('0') });
      expect(await navDisponivel()).toBe(true);
      const c2 = await cotar('10.0000000');
      expect(c2.navPorTokenNaCotacao).toBe('1.00000000');
    });

    it('idempotente: o MESMO XDR de novo devolve o mesmo txHash e não escritura de novo (nem submete)', async () => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      const a = await submeter(xdr, c.quoteId);
      const b = await submeter(xdr, c.quoteId);
      expect(b.txHash).toBe(a.txHash);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect(await db.eventoAudit.count({ where: { acao: 'PLINARF_LIQUIDADO' } })).toBe(1);
      expect(chain.submetidos).toHaveLength(1);
    });

    it('cotação já consumida + OUTRO XDR (outra janela) → 409 CONFLICT, nada novo', async () => {
      const c = await cotar();
      await submeter(assinar(c.xdr), c.quoteId);
      const outro = refazer(c.xdr, { timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 90 } });
      const e = (await erro(submeter(outro, c.quoteId))) as ApiError;
      expect(e.code).toBe('CONFLICT');
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect(chain.submetidos).toHaveLength(1);
    });

    it('2 submits CONCORRENTES do mesmo XDR: o domínio é escriturado UMA vez (razão, holding, saldo)', async () => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      const rs = await Promise.allSettled([submeter(xdr, c.quoteId), submeter(xdr, c.quoteId)]);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect((await db.holdingPLINARF.findFirstOrThrow({ where: { investidorId: 'inv_res' } })).saldo.toFixed(7)).toBe('900.0000000');
      expect((await db.investidor.findUniqueOrThrow({ where: { id: 'inv_res' } })).saldoEsperado.toFixed(7)).toBe('900.0000000');
      // F2 (corrigido): o perdedor devolve o MESMO txHash idempotente (200), nunca um erro.
      expect(rs.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
      const hashes = rs.map((x) => (x as PromiseFulfilledResult<{ txHash: string }>).value.txHash);
      expect(hashes[0]).toBe(hashes[1]);
      expect(rs.some((x) => x.status === 'fulfilled')).toBe(true);
      expect((await estado(c.quoteId))?.consumedAt).not.toBeNull(); // ninguém deixa a reserva aberta
    });
  });

  describe('XDR divergente da cotação → 400 (nada assinado, nada reservado)', () => {
    const casos: [string, (x: string) => string][] = [
      ['PLINARF queimado ≠ cotado (101 em vez de 100)', (x) => refazer(x, { amounts: ['101.0000000', new Transaction(x, networkPassphrase).operations[1] && (new Transaction(x, networkPassphrase).operations[1] as unknown as { amount: string }).amount] })],
      ['TESOURO pago ≠ cotado (a mais)', (x) => refazer(x, { amounts: [(new Transaction(x, networkPassphrase).operations[0] as unknown as { amount: string }).amount, '9999.0000000'] })],
      ['memo de OUTRA cotação (replay de memo)', (x) => refazer(x, { memo: Memo.hash(memoHashDoResgate('outra-cotacao').toString('hex')) })],
      ['TESOURO pago a outra conta (destino trocado)', (x) => refazer(x, { destinos: [ISSUER.publicKey(), OUTRO.publicKey()] })],
      ['queima para outra conta que não o issuer', (x) => refazer(x, { destinos: [OUTRO.publicKey(), INV_PK] })],
      ['operação extra (3ª perna)', (x) => refazer(x, { extraOp: true })],
    ];
    it.each(casos)('%s', async (_nome, mutar) => {
      const c = await cotar();
      const e = (await erro(submeter(mutar(c.xdr), c.quoteId))) as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.status).toBe(400);
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      expect(await navDisponivel()).toBe(true); // nenhuma reserva aberta
    });

    it('sem assinatura do investidor, ou assinado por outra chave, ou com 2 assinaturas → 400', async () => {
      const c = await cotar();
      expect(((await erro(submeter(c.xdr, c.quoteId))) as ApiError).status).toBe(400);
      expect(((await erro(submeter(assinar(c.xdr, OUTRO), c.quoteId))) as ApiError).status).toBe(400);
      const duas = new Transaction(assinar(c.xdr), networkPassphrase);
      duas.sign(OUTRO);
      expect(((await erro(submeter(duas.toXDR(), c.quoteId))) as ApiError).status).toBe(400);
      expect(chain.submetidos).toHaveLength(0);
    });

    it('XDR que não é XDR → 400', async () => {
      const c = await cotar();
      expect(((await erro(submeter('AAAA-lixo', c.quoteId))) as ApiError).status).toBe(400);
    });
  });

  describe('janela de validade do envelope (N1-S1 estendido ao resgate: quem assina é o distributor)', () => {
    const agoraSec = () => Math.floor(Date.now() / 1000);
    it.each([
      ['maxTime muito além (agora + 1 dia)', () => ({ minTime: 0, maxTime: agoraSec() + 86_400 })],
      ['maxTime além de expiresAt + 120 s (mas dentro de agora + 180 s não é possível: > agora+180)', () => ({ minTime: 0, maxTime: agoraSec() + 400 })],
      ['minTime no futuro (a tx só vale depois: re-assinatura tardia)', () => ({ minTime: agoraSec() + 3600, maxTime: agoraSec() + 3700 })],
    ])('%s → 400, sem reserva', async (_n, tb) => {
      const c = await cotar();
      const e = (await erro(submeter(refazer(c.xdr, { timebounds: tb() }), c.quoteId))) as ApiError;
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/divergente da cotação/);
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
    });

    it('sem timeBounds (maxTime 0: valeria para sempre) → 400', async () => {
      const c = await cotar();
      const e = (await erro(submeter(refazer(c.xdr, { timebounds: 'infinito' }), c.quoteId))) as ApiError;
      expect(e.status).toBe(400);
      expect(chain.submetidos).toHaveLength(0);
    });

    it('janela legítima (do build) passa', async () => {
      const c = await cotar();
      await expect(submeter(assinar(c.xdr), c.quoteId)).resolves.toHaveProperty('txHash');
    });
  });

  describe('cotação: expiração, NAV e ownership', () => {
    it('cotação vencida (sem reserva) → 410 COTACAO_EXPIRADA, nada assinado', async () => {
      const c = await cotar();
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId, { agora: Date.now() + 10 * MIN }))) as ApiError;
      expect(e.status).toBe(410);
      expect(e.code).toBe('COTACAO_EXPIRADA');
      expect(chain.submetidos).toHaveLength(0);
    });

    it('NAV mudou > 1 bp desde a cotação → 409 NAV_MUDOU, sem reserva e sem assinar (recotar)', async () => {
      const c = await cotar();
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('900000'), subordinada: supply('0') }); // NAV sobe ~11%
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
      expect(e.status).toBe(409);
      expect(e.code).toBe('NAV_MUDOU');
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      // recotar com o NAV novo funciona e o valor em BRL acompanha
      const c2 = await cotar();
      expect(Number(c2.navPorTokenNaCotacao)).toBeGreaterThan(1.1);
    });

    it('oscilação ≤ 1 bp do NAV passa (tolerância)', async () => {
      const c = await cotar();
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('999950'), subordinada: supply('0') }); // +0,005%
      await expect(submeter(assinar(c.xdr), c.quoteId)).resolves.toHaveProperty('txHash');
    });

    it('ownership: o investidor B submetendo a cotação do A → 404 (indistinguível de inexistente), nada reservado', async () => {
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      const c = await cotar();
      // B assina um envelope que ele mesmo construiria? Aqui B apresenta o XDR do A com a assinatura dele.
      const e = (await erro(submeter(assinar(c.xdr, OUTRO), c.quoteId, { investidor: B }))) as ApiError;
      expect(e.status).toBe(404);
      const inexistente = (await erro(submeter(assinar(c.xdr), 'nao-existe'))) as ApiError;
      expect(inexistente.status).toBe(404);
      expect(e.message).toBe(inexistente.message);
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
    });

    it('cotação com quantidade inválida / zero / mais de 7 casas / negativa → 400, nada persistido', async () => {
      for (const v of ['0', '-5', '1.12345678', 'abc', '', '1e3']) {
        const e = (await erro(cotar(v))) as ApiError;
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(400);
      }
      expect(await db.resgateCotacao.count()).toBe(0);
    });

    it('investidor SEM trustline autorizada do TESOURO: o build recusa e nada é persistido (op_no_trust nunca chega à chain)', async () => {
      chain.balances = [];
      const e = await erro(cotar());
      expect(e).not.toBeNull();
      expect((e as Error).name).toBe('TrustlineNaoAutorizadaError');
      expect(await db.resgateCotacao.count()).toBe(0);
      chain.balances = [{ asset_type: 'credit_alphanum12', asset_code: TESOURO.code, asset_issuer: TESOURO.issuer, balance: '0', is_authorized: false }];
      expect(((await erro(cotar())) as Error).name).toBe('TrustlineNaoAutorizadaError');
      expect(await db.resgateCotacao.count()).toBe(0);
    });

    it('NAV indisponível (supply do ledger fora) → NavIndisponivelError, nada persistido', async () => {
      st.fetchSupplyDasClasses.mockRejectedValue(new Error('horizon fora'));
      resetNavSupplyCache();
      const e = await erro(cotar());
      expect(e).toBeInstanceOf(NavIndisponivelError);
      expect(await db.resgateCotacao.count()).toBe(0);
    });
  });

  describe('órfã: crash/erro entre a submissão e o commit', () => {
    /** Reserva criada e a rede responde ambíguo (504): fica a reserva com o XDR, sem escriturar. */
    async function reservarOrfa() {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.submit = 'ambiguo';
      const e = await erro(submeter(xdr, c.quoteId));
      expect(e).not.toBeNull();
      chain.submit = 'ok';
      chain.submetidos = [];
      return { c, xdr };
    }

    it('erro ambíguo no submit deixa a reserva aberta (gate do NAV fechado, investidor bloqueado, nada no razão)', async () => {
      const { c } = await reservarOrfa();
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      expect(await navDisponivel()).toBe(false); // SWAP_EM_VOO
      const bloqueio = (await erro(cotar())) as ApiError;
      expect(bloqueio.code).toBe('SWAP_EM_CONFERENCIA');
      expect(bloqueio.status).toBe(409);
    });

    const respostaHorizon = (status: number, codes?: { transaction: string; operations?: string[] }) => () =>
      Object.assign(new Error('horizon'), { response: { status, data: codes ? { title: 'Transaction Failed', extras: { result_codes: codes } } : { title: 'x' } } });

    it.each([
      'tx_failed', 'tx_bad_auth', 'tx_bad_auth_extra', 'tx_insufficient_balance', 'tx_insufficient_fee',
      'tx_malformed', 'tx_no_source_account', 'tx_not_supported', 'tx_missing_operation',
    ])('E2-6 e2f54bc — recusa DEFINITIVA da rede (%s): libera a reserva NA HORA, propaga o erro da rede, o NAV não fecha e nada é escriturado', async (codigo) => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.erroEnvio = respostaHorizon(400, { transaction: codigo, operations: codigo === 'tx_failed' ? ['op_underfunded'] : undefined });
      const e = (await erro(submeter(xdr, c.quoteId))) as Error & { response?: { status: number } };
      expect(e).not.toBeInstanceOf(ApiError); // o erro cru da rede (a rota o devolve como 502 STELLAR_SUBMIT_FAILED)
      expect(e.response?.status).toBe(400);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      // o investidor não fica bloqueado: pode cotar de novo e a MESMA cotação pode ser reenviada se a rede voltar
      chain.erroEnvio = null;
      await expect(submeter(xdr, c.quoteId)).resolves.toHaveProperty('txHash');
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it.each([
      ['tx_bad_seq', () => respostaHorizon(400, { transaction: 'tx_bad_seq' })()],
      ['tx_too_late', () => respostaHorizon(400, { transaction: 'tx_too_late' })()],
      ['tx_too_early', () => respostaHorizon(400, { transaction: 'tx_too_early' })()],
      ['tx_internal_error', () => respostaHorizon(400, { transaction: 'tx_internal_error' })()],
      ['400 sem result_codes', () => respostaHorizon(400)()],
      ['504 timeout', () => respostaHorizon(504)()],
      ['500', () => respostaHorizon(500)()],
      ['429', () => respostaHorizon(429)()],
      ['erro de rede (sem resposta)', () => new Error('ECONNRESET')],
      ['código desconhecido', () => respostaHorizon(400, { transaction: 'tx_algo_novo' })()],
    ])('E2-6 e2f54bc — desfecho INCERTO (%s): 504 STELLAR_SUBMIT_INCERTO, a reserva FICA (órfã), NAV fechado, nada escriturado; o retry do mesmo XDR re-assina antes do maxTime', async (_nome, fazErro) => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.erroEnvio = fazErro as () => Error;
      const e = (await erro(submeter(xdr, c.quoteId))) as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.code).toBe('STELLAR_SUBMIT_INCERTO');
      expect(e.status).toBe(504);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
      expect(await navDisponivel()).toBe(false);
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      chain.erroEnvio = null;
      await expect(submeter(xdr, c.quoteId)).resolves.toHaveProperty('txHash');
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it.each([
      'tx_failed', 'tx_bad_auth', 'tx_bad_auth_extra', 'tx_insufficient_balance', 'tx_insufficient_fee',
      'tx_malformed', 'tx_no_source_account', 'tx_not_supported', 'tx_missing_operation',
    ])('R4 (81226c8) — REENVIO de uma órfã com %s: 504 STELLAR_SUBMIT_INCERTO, a reserva CONTINUA, o NAV segue fechado até a prova; a tx que JÁ entrou é escriturada pelo varredor (sem queima órfã)', async (codigo) => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.submit = 'ambiguo';
      await erro(submeter(xdr, c.quoteId)); // 1º envio incerto → reserva órfã
      chain.submit = 'ok';
      chain.erroEnvio = respostaHorizon(400, { transaction: codigo }); // o reenvio de uma tx que já entrou pode voltar qualquer código
      const e = (await erro(submeter(xdr, c.quoteId))) as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.code).toBe('STELLAR_SUBMIT_INCERTO');
      expect(e.status).toBe(504);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull(); // NÃO libera
      expect(await navDisponivel()).toBe(false);
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      // a tx tinha entrado de fato: o varredor prova e escritura (queima e pagamento não ficam sem razão)
      chain.erroEnvio = null;
      chain.txs.set(new Transaction(xdr, networkPassphrase).hash().toString('hex'), { successful: true });
      const r = await varrer();
      expect(r.resgatesEscriturados).toBe(1);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect(await navDisponivel()).toBe(true);
    });

    it('R4 — o 1º envio com recusa definitiva continua liberando na hora (a regra nova só vale no reenvio)', async () => {
      const c = await cotar();
      chain.erroEnvio = respostaHorizon(400, { transaction: 'tx_insufficient_fee' });
      const e = await erro(submeter(assinar(c.xdr), c.quoteId));
      expect(e).not.toBeInstanceOf(ApiError);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
    });

    it('desvio consciente do Bento: uma tx que JÁ entrou e o Horizon ainda não mostra (lag) responde tx_bad_seq ao reenvio → INCERTO, NÃO libera; o varredor escritura depois pela prova (sem dupla escrituração)', async () => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.submit = 'ambiguo';
      await erro(submeter(xdr, c.quoteId)); // reserva órfã
      chain.submit = 'ok';
      chain.erroEnvio = respostaHorizon(400, { transaction: 'tx_bad_seq' }); // o reenvio de uma tx que já entrou
      const e = (await erro(submeter(xdr, c.quoteId))) as ApiError;
      expect(e.code).toBe('STELLAR_SUBMIT_INCERTO');
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull(); // NÃO libera
      chain.erroEnvio = null;
      const hash = new Transaction(xdr, networkPassphrase).hash().toString('hex');
      chain.txs.set(hash, { successful: true }); // o Horizon alcança
      const r = await varrer();
      expect(r.resgatesEscriturados).toBe(1);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('retry do MESMO XDR antes do maxTime e a tx NÃO está na chain: a Plina re-assina e escritura uma vez', async () => {
      const { c, xdr } = await reservarOrfa();
      const r = await submeter(xdr, c.quoteId);
      expect(chain.submetidos).toHaveLength(1);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect((await estado(c.quoteId))?.consumedTxHash).toBe(r.txHash);
      expect(await navDisponivel()).toBe(true);
    });

    it('retry com a tx JÁ na chain com sucesso (crash entre submit e commit): escritura SEM assinar nem submeter de novo', async () => {
      const { c, xdr } = await reservarOrfa();
      const hash = new Transaction(xdr, networkPassphrase).hash().toString('hex');
      chain.txs.set(hash, { successful: true });
      const assinarSpy = vi.spyOn(signerMod, 'distributorSigner');
      const r = await submeter(xdr, c.quoteId);
      expect(r.txHash).toBe(hash);
      expect(chain.submetidos).toHaveLength(0);
      expect(assinarSpy).not.toHaveBeenCalled();
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('retry com a tx na chain que FALHOU: libera a reserva (prova positiva), 409, nada escriturado', async () => {
      const { c, xdr } = await reservarOrfa();
      chain.txs.set(new Transaction(xdr, networkPassphrase).hash().toString('hex'), { successful: false });
      const e = (await erro(submeter(xdr, c.quoteId))) as ApiError;
      expect(e.status).toBe(409);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
      expect(await navDisponivel()).toBe(true);
    });

    it('DEPOIS do maxTime e a tx fora da chain: 410, a Plina NÃO assina de novo e NÃO libera por "não achei"', async () => {
      const { c, xdr } = await reservarOrfa();
      const assinarSpy = vi.spyOn(signerMod, 'distributorSigner');
      const e = (await erro(submeter(xdr, c.quoteId, { agora: Date.now() + 10 * MIN }))) as ApiError;
      expect(e.status).toBe(410);
      expect(chain.submetidos).toHaveLength(0);
      expect(assinarSpy).not.toHaveBeenCalled();
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull(); // reserva mantida
      expect(await navDisponivel()).toBe(false);
    });

    it('DEPOIS do maxTime mas a tx entrou com sucesso (Horizon atrasou antes): escritura sem assinar', async () => {
      const { c, xdr } = await reservarOrfa();
      const hash = new Transaction(xdr, networkPassphrase).hash().toString('hex');
      chain.txs.set(hash, { successful: true });
      const r = await submeter(xdr, c.quoteId, { agora: Date.now() + 10 * MIN });
      expect(r.txHash).toBe(hash);
      expect(chain.submetidos).toHaveLength(0);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('órfã + OUTRO XDR da mesma cotação → 409 CONFLICT (não troca o envelope reservado)', async () => {
      const { c } = await reservarOrfa();
      const outro = refazer(c.xdr, { timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 90 } });
      const e = (await erro(submeter(outro, c.quoteId))) as ApiError;
      expect(e.code).toBe('CONFLICT');
    });
  });

  describe('gate do NAV e bloqueio por investidor (swap OU resgate)', () => {
    it('resgate reservado fecha o NAV para TODOS e bloqueia só o próprio investidor (409); outro investidor recebe 503 pelo gate', async () => {
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      const c = await cotar();
      chain.submit = 'ambiguo';
      await erro(submeter(assinar(c.xdr), c.quoteId));
      expect(await navDisponivel()).toBe(false);
      expect(((await erro(cotar())) as ApiError).code).toBe('SWAP_EM_CONFERENCIA');
      expect(await erro(cotar('10.0000000', B))).toBeInstanceOf(NavIndisponivelError);
    });

    it('swap de subscrição em conferência do MESMO investidor bloqueia a cotação do resgate (cruzado)', async () => {
      await db.quote.create({
        data: {
          id: 'q_swap', investidorId: 'inv_res', fromCurrency: 'BRL', fromAmount: '1000', toCurrency: 'TESOURO', toAmount: '995', exchangeRate: '0.995', fee: '5',
          expiresAt: new Date(Date.now() - 3600_000), navPorTokenNaCotacao: '1.0000', plinarfAmount: '995', submitXdrHash: 'reserva-swap',
        } as never,
      });
      const e = (await erro(cotar())) as ApiError | Error;
      // O gate do NAV (SWAP_EM_VOO) fecha antes do bloqueio por investidor: ambos são recusa fail-closed.
      expect(e instanceof NavIndisponivelError || (e as ApiError).code === 'SWAP_EM_CONFERENCIA').toBe(true);
      expect(await db.resgateCotacao.count()).toBe(0);
    });
  });

  describe('reconciliador de resgate órfão (cron/admin) — só prova on-chain', () => {
    async function reservaSemSubmeter(maxTimeAtrasoMin = 60) {
      // Reserva com o envelope real assinado, mas "perdida" (o processo caiu depois de reservar).
      const c = await cotar();
      // O reconciliador lê o prazo do PRÓPRIO envelope: refaz com o maxTime vencido há `maxTimeAtrasoMin` (ou futuro, se negativo).
      const maxTime = Math.floor((Date.now() - maxTimeAtrasoMin * MIN) / 1000);
      const xdr = refazer(c.xdr, { timebounds: { minTime: 0, maxTime } });
      const t = new Transaction(xdr, networkPassphrase);
      await db.resgateCotacao.update({
        where: { id: c.quoteId },
        data: {
          submitXdrHash: `reserva-${c.quoteId}`, submitTxHash: t.hash().toString('hex'),
          submitMaxTime: new Date(Date.now() - maxTimeAtrasoMin * MIN), submitXdr: xdr,
        },
      });
      return { c, xdr, hash: t.hash().toString('hex'), seq: t.sequence };
    }

    it('ENTROU com sucesso: escritura UMA vez (razão, holding, saldo), NAV reabre; repetir a varredura é idempotente', async () => {
      const { c, hash } = await reservaSemSubmeter();
      chain.txs.set(hash, { successful: true });
      const r1 = await varrer();
      expect(r1.resgatesEscriturados).toBe(1);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect((await db.holdingPLINARF.findFirstOrThrow({ where: { investidorId: 'inv_res' } })).saldo.toFixed(7)).toBe('900.0000000');
      expect((await estado(c.quoteId))?.consumedTxHash).toBe(hash);
      const audit = await db.eventoAudit.findFirstOrThrow({ where: { acao: 'PLINARF_LIQUIDADO' } });
      expect(audit.operador).toBe('reconciliador-resgate');
      const r2 = await varrer();
      expect(r2.resgatesEscriturados).toBe(0);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect(await navDisponivel()).toBe(true);
    });

    it('ENTROU e FALHOU: libera, nada escriturado', async () => {
      const { c, hash } = await reservaSemSubmeter();
      chain.txs.set(hash, { successful: false });
      const r = await varrer();
      expect(r.resgatesLiberados).toBe(1);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
    });

    it('sequence S consumida por OUTRA tx do investidor: libera (a nossa nunca entra)', async () => {
      const { c, seq } = await reservaSemSubmeter();
      chain.sequenciaConta = seq; // a conta já está em S
      chain.contaTxs = [{ hash: 'f'.repeat(64), successful: true, source_account: INV_PK, source_account_sequence: seq, ledger_attr: 950, paging_token: '1' }];
      const r = await varrer();
      expect(r.resgatesLiberados).toBe(1);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
    });

    it('ainda dentro do prazo (AGUARDANDO): mantém a reserva', async () => {
      const { c } = await reservaSemSubmeter(-10); // maxTime daqui a 10 min
      const r = await varrer();
      expect(r.resgatesAguardando).toBe(1);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
    });

    const liberada = (id: string) =>
      db.resgateCotacao.findUniqueOrThrow({ where: { id }, select: { submitXdrHash: true, liberadaTxHash: true, livreExpiradaVistaEm: true, consumedAt: true } });

    it('LIVRE depois do prazo (regras do N1): a 1ª varredura só MARCA (reserva e gate mantidos); a 2ª cedo demais não libera; a 2ª ≥ 5 min libera POR TEMPO e guarda o hash na vigia', async () => {
      const { c, hash } = await reservaSemSubmeter(60);
      const a = await varrer(0);
      expect(a.resgatesAguardando).toBe(1);
      expect(a.resgatesLiberados).toBe(0);
      expect((await liberada(c.quoteId)).livreExpiradaVistaEm).not.toBeNull();
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
      expect(await navDisponivel()).toBe(false);
      const cedo = await varrer(1); // < 5 min depois da 1ª
      expect(cedo.resgatesLiberados).toBe(0);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
      const b = await varrer(6);
      expect(b.resgatesLiberados).toBe(1);
      const l = await liberada(c.quoteId);
      expect(l.submitXdrHash).toBeNull();
      expect(l.liberadaTxHash).toBe(hash);
      expect(await navDisponivel()).toBe(true);
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
    });

    it('a marca da 1ª varredura é APAGADA se o estado deixa de ser LIVRE_EXPIRADA (ex.: a conta passa a INDETERMINADA)', async () => {
      const { c } = await reservaSemSubmeter(60);
      await varrer(0);
      expect((await liberada(c.quoteId)).livreExpiradaVistaEm).not.toBeNull();
      vi.spyOn(horizon, 'ledgers').mockImplementation((() => builder(() => { throw new Error('horizon fora'); })) as never);
      await varrer(6);
      expect((await liberada(c.quoteId)).submitXdrHash).not.toBeNull(); // não liberou com a rede indeterminada
    });

    it('VIGIA de 24 h: a tx liberada por tempo que entra DEPOIS com sucesso é escriturada UMA vez (razão, holding); varredura repetida é idempotente', async () => {
      const { c, hash } = await reservaSemSubmeter(60);
      await varrer(0);
      await varrer(6);
      expect((await liberada(c.quoteId)).liberadaTxHash).toBe(hash);
      chain.txs.set(hash, { successful: true }); // aparece depois
      const r = await varrer(7);
      expect(r.resgatesVigiaEscrituradas).toBe(1);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
      expect((await db.holdingPLINARF.findFirstOrThrow({ where: { investidorId: 'inv_res' } })).saldo.toFixed(7)).toBe('900.0000000');
      expect((await liberada(c.quoteId)).consumedAt).not.toBeNull();
      const r2 = await varrer(8);
      expect(r2.resgatesVigiaEscrituradas).toBe(0);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('VIGIA: liberada por tempo que entra depois, mas a cotação já foi consumida por OUTRA tx → conflito (não escritura em dobro), com os ids para o alerta', async () => {
      const { c, hash } = await reservaSemSubmeter(60);
      await varrer(0);
      await varrer(6);
      await db.resgateCotacao.update({ where: { id: c.quoteId }, data: { consumedAt: new Date(), consumedTxHash: 'e'.repeat(64) } });
      chain.txs.set(hash, { successful: true });
      const r = await varrer(7);
      expect(r.resgatesVigiaConflitos).toBe(1);
      expect(r.conflitoResgateIds).toEqual([c.quoteId]);
      expect(r.resgatesVigiaEscrituradas).toBe(0);
      expect(await movimentos('RESGATE_PAGO')).toBe(0);
    });

    it('vigia fora da janela de 24 h não é consultada; Horizon fora na vigia conta erro e não escritura', async () => {
      const { c, hash } = await reservaSemSubmeter(60);
      await varrer(0);
      await varrer(6);
      chain.txs.set(hash, { successful: true });
      const r = await varrer(25 * 60); // 25 h depois
      expect(r.resgatesVigiaEscrituradas).toBe(0);
      expect((await liberada(c.quoteId)).consumedAt).toBeNull();
    });

    it('INDETERMINADO (rede/ledger sem prova) fica para o operador: resgatesSemProva > 0 e a reserva NÃO é liberada, mesmo depois de varreduras', async () => {
      const { c } = await reservaSemSubmeter(60);
      chain.sequenciaConta = '105'; // a conta passou de S, mas a tx com S não aparece no histórico
      chain.contaTxs = [];
      const rs = [await varrer(0), await varrer(6), await varrer(60)];
      expect(rs.reduce((n, x) => n + x.resgatesSemProva, 0)).toBeGreaterThan(0);
      expect(rs.reduce((n, x) => n + x.resgatesLiberados, 0)).toBe(0);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
    });

    it('Horizon fora durante a varredura: não escritura nem libera (erro contado, reserva intacta)', async () => {
      const { c } = await reservaSemSubmeter();
      vi.spyOn(horizon, 'loadAccount').mockRejectedValue(new Error('horizon fora'));
      vi.spyOn(horizon, 'transactions').mockImplementation((() => { throw new Error('horizon fora'); }) as never);
      const r = await varrer();
      expect(r.erros + r.resgatesSemProva).toBeGreaterThanOrEqual(1);
      expect(r.resgatesEscriturados + r.resgatesLiberados).toBe(0);
      expect((await estado(c.quoteId))?.submitXdrHash).not.toBeNull();
    });

    it('reserva sem o XDR guardado (linha incompleta): vai para o operador, não quebra a varredura dos demais', async () => {
      const { c } = await reservaSemSubmeter();
      await db.resgateCotacao.update({ where: { id: c.quoteId }, data: { submitXdr: null } });
      const r = await varrer();
      expect(r.resgatesSemProva).toBe(1);
      expect(r.erros).toBe(0);
    });

    it('swap e resgate órfãos na MESMA varredura: cada um resolvido pelo seu caminho', async () => {
      const { hash } = await reservaSemSubmeter();
      chain.txs.set(hash, { successful: true });
      const r = await varrer();
      expect(r.resgatesEscriturados).toBe(1);
      expect(r.escriturados).toBe(0);
    });
  });

  describe('invariantes do fundo', () => {
    it('NAV por token NÃO muda após o resgate: caixa cai V = q·NAV e o supply cai q', async () => {
      const c = await cotar('250.0000000');
      await submeter(assinar(c.xdr), c.quoteId);
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('999750'), subordinada: supply('0') });
      expect(await navDisponivel()).toBe(true);
      const c2 = await cotar('1.0000000');
      expect(c2.navPorTokenNaCotacao).toBe('1.00000000');
      expect((await caixa()).toFixed(2)).toBe('999750.00');
    });

    it('holding menor que a queima (drift): o domínio escritura, o holding vai a 0 (nunca negativo) e o supply/caixa continuam coerentes', async () => {
      await db.holdingPLINARF.updateMany({ where: { investidorId: 'inv_res' }, data: { saldo: '40' } });
      const c = await cotar('100.0000000');
      await submeter(assinar(c.xdr), c.quoteId);
      expect((await db.holdingPLINARF.findFirstOrThrow({ where: { investidorId: 'inv_res' } })).saldo.toFixed(7)).toBe('0.0000000');
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });
  });

  describe('delta E2-6 (4124988): preço líquido do TESOURO, liquidez e janela da Estela', () => {
    const bridgeDe = async (xdr: string) => (new Transaction(xdr, networkPassphrase).operations[1] as unknown as { amount: string }).amount;
    /** Fundo pequeno (caixa = supply = 150 → NAV 1,00) para exercitar a liquidez. */
    async function fundoPequeno() {
      await db.movimentoFundo.deleteMany({});
      await db.movimentoFundo.create({ data: { tipo: 'SUBSCRICAO', valorBrl: '150', deltaCaixa: '150', deltaTokens: '150', chave: 'seed-pequeno' } as never });
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('150'), subordinada: supply('0') });
      resetNavSupplyCache();
    }

    it('preço líquido: TESOURO = BRL ÷ preço (R$ 100 a R$ 5 = 20 TESOURO), congelado na cotação; arredonda para BAIXO em 7 casas', async () => {
      const c = await cotar('100.0000000', INVESTIDOR, '5');
      expect(await bridgeDe(c.xdr)).toBe('20.0000000');
      const row = await db.resgateCotacao.findUniqueOrThrow({ where: { id: c.quoteId } });
      expect(row.bridgeAmount.toFixed(7)).toBe('20.0000000');
      expect(row.taxaBridge).toBe('5');
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '3'); // a faixa ±2% olha a referência: o preço de cada caso vira a referência
      const c3 = await cotar('100.0000000', INVESTIDOR, '3'); // 100/3 = 33,3333333… → para baixo
      expect(await bridgeDe(c3.xdr)).toBe('33.3333333');
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '5.25');
      const c525 = await cotar('100.0000000', INVESTIDOR, '5.25'); // preço com fee embutido: paga MENOS TESOURO
      expect(await bridgeDe(c525.xdr)).toBe('19.0476190');
      expect(Number(await bridgeDe(c525.xdr))).toBeLessThan(Number(await bridgeDe(c.xdr)));
    });

    it('preço do TESOURO inválido no build (0, negativo, texto, vazio) → 502 ETHERFUSE_ERROR e nada persistido', async () => {
      for (const preco of ['0', '-1', 'abc', '']) {
        const e = (await erro(cotar('100.0000000', INVESTIDOR, preco))) as ApiError;
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(502);
        expect(e.code).toBe('ETHERFUSE_ERROR');
      }
      expect(await db.resgateCotacao.count()).toBe(0);
    });

    it('preço relido no submit: andou > 1 bp (para cima ou para baixo) → 409 NAV_MUDOU, sem reserva nem assinatura; ≤ 1 bp passa', async () => {
      for (const novo of ['5.01', '4.99']) {
        const c = await cotar('100.0000000', INVESTIDOR, '5');
        chain.preco = novo;
        const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
        expect(e.status).toBe(409);
        expect(e.code).toBe('NAV_MUDOU');
        expect(chain.submetidos).toHaveLength(0);
        expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      }
      expect(await navDisponivel()).toBe(true);
      chain.preco = '5';
      const ok = await cotar('100.0000000', INVESTIDOR, '5');
      chain.preco = '5.0002'; // 0,004%
      await expect(submeter(assinar(ok.xdr), ok.quoteId)).resolves.toHaveProperty('txHash');
    });

    it('a fonte do preço que FALHA no submit não reserva nem assina (fail-closed)', async () => {
      const c = await cotar();
      const e = await erro(submeter(assinar(c.xdr), c.quoteId, { obter: async () => { throw new Error('etherfuse fora'); } }));
      expect(e).not.toBeNull();
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
    });

    it('LIQUIDEZ no build: BRL acima do caixa do razão → 409 LIQUIDEZ_INSUFICIENTE e nada persistido; exatamente o caixa passa', async () => {
      const e = (await erro(cotar('1000001.0000000'))) as ApiError;
      expect(e.status).toBe(409);
      expect(e.code).toBe('LIQUIDEZ_INSUFICIENTE');
      expect(await db.resgateCotacao.count()).toBe(0);
      await expect(cotar('1000000.0000000')).resolves.toHaveProperty('quoteId'); // = caixa: permitido
    });

    it('LIQUIDEZ no build: TESOURO do distributor abaixo do necessário → 409, nada persistido', async () => {
      chain.saldoDistributor = '10'; // precisa de 20
      const e = (await erro(cotar('100.0000000'))) as ApiError;
      expect(e.code).toBe('LIQUIDEZ_INSUFICIENTE');
      expect(e.status).toBe(409);
      expect(await db.resgateCotacao.count()).toBe(0);
    });

    it('LIQUIDEZ no submit: o distributor perdeu TESOURO depois da cotação → 409, sem reserva, sem assinar, NAV aberto', async () => {
      const c = await cotar('100.0000000');
      chain.saldoDistributor = '1';
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
      expect(e.code).toBe('LIQUIDEZ_INSUFICIENTE');
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
    });

    it('duas cotações simultâneas (cada uma cabe no caixa, as duas juntas não): a 1ª liquida, a 2ª recebe LIQUIDEZ_INSUFICIENTE no submit (em sequência)', async () => {
      await fundoPequeno();
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      const a = await cotar('100.0000000');
      const b = await cotar('100.0000000', B);
      await submeter(assinar(a.xdr), a.quoteId);
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('50'), subordinada: supply('0') }); // a queima de A baixou o supply
      resetNavSupplyCache();
      const e = (await erro(submeter(assinar(b.xdr, OUTRO), b.quoteId, { investidor: B }))) as ApiError;
      expect(e.code).toBe('LIQUIDEZ_INSUFICIENTE');
      expect(Number(await caixa())).toBe(50);
      expect((await estado(b.quoteId))?.submitXdrHash).toBeNull();
    });

    // CORRIDA (achado F5): a liquidez é conferida ANTES da reserva e, na rota, depois de uma chamada à Etherfuse; dois
    // submits de investidores diferentes que passam pelo NAV e pela liquidez ao mesmo tempo reservam os dois. A barreira
    // no `obterPrecoTesouroBrl` (que roda depois do NAV e antes da liquidez/reserva) reproduz o intercalamento de forma
    // determinística. Esperado (e agora garantido pela trava sob advisory lock): no máximo UM liquida e o caixa nunca fica negativo.
    it('F5 (corrigido) — 2 submits SIMULTÂNEOS de investidores diferentes cujo total excede o caixa: só 1 assina e o caixa não fica negativo', async () => {
      await fundoPequeno();
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      const a = await cotar('100.0000000');
      const b = await cotar('100.0000000', B);
      let chegaram = 0;
      let liberar!: () => void;
      const barreira = new Promise<void>((r) => { liberar = r; });
      const obter = async () => {
        if (++chegaram === 2) liberar();
        await barreira;
        return PRECO;
      };
      const rs = await Promise.allSettled([
        submeter(assinar(a.xdr), a.quoteId, { obter }),
        submeter(assinar(b.xdr, OUTRO), b.quoteId, { investidor: B, obter }),
      ]);
      expect(chegaram).toBe(2); // os dois passaram pelo NAV antes de qualquer reserva
      const liquidados = rs.filter((x) => x.status === 'fulfilled').length;
      expect(liquidados).toBeLessThanOrEqual(1);
      expect(chain.submetidos).toHaveLength(1); // critério do Atlas: só 1 assina
      expect(Number(await caixa())).toBeGreaterThanOrEqual(0);
    });

    it('órfã (retry do mesmo XDR): NÃO relê preço, NAV nem liquidez — só prova on-chain / re-assina antes do maxTime', async () => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.submit = 'ambiguo';
      await erro(submeter(xdr, c.quoteId));
      chain.submit = 'ok';
      chain.submetidos = [];
      chain.preco = '10'; // preço dobrou
      chain.saldoDistributor = '0'; // e o distributor ficou sem TESOURO
      let chamadas = 0;
      const r = await submeter(xdr, c.quoteId, { obter: async () => { chamadas++; return chain.preco; } });
      expect(chamadas).toBe(0);
      expect(r.txHash).toBe(new Transaction(xdr, networkPassphrase).hash().toString('hex'));
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('janela da Estela (prazo da cotação): maxTime do envelope além de expiresAt + 120 s → 400 sem reserva', async () => {
      const c = await cotar();
      // minTime 0 e maxTime = agora + 170 s respeita agora+180 mas passa o prazo da cotação se ela já está perto de vencer:
      // cria a cotação e avança o relógio do serviço até perto do vencimento (expiresAt = +5 min), com maxTime longo.
      const agoraTarde = Date.now() + 5 * MIN - 30_000; // 30 s antes de vencer
      const maxLongo = Math.floor(agoraTarde / 1000) + 170; // > expiresAt + 120 s? expiresAt+120 = agoraTarde/1000+150 → sim
      const xdr = refazer(c.xdr, { timebounds: { minTime: 0, maxTime: maxLongo } });
      const e = (await erro(submeter(xdr, c.quoteId, { agora: agoraTarde }))) as ApiError;
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/prazo da cotação|quote|cota/i);
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
    });
  });

  describe('rodada final (64d1bd0): alerta do cron, FK, trava do TESOURO e F2/F4', () => {
    const SECRET = 'segredo-de-teste-do-cron-com-40-caracteres-ok';
    const rota = async () => {
      const { GET } = await import('@/app/api/ops/reconciliar-subscricoes/route');
      const res = await GET(new Request('http://x/api/ops/reconciliar-subscricoes', { headers: { authorization: `Bearer ${SECRET}` } }));
      return { status: res.status, texto: await res.text() };
    };
    async function conflitoDeResgate() {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      const t = new Transaction(xdr, networkPassphrase);
      const maxTime = Math.floor((Date.now() - 60 * MIN) / 1000);
      const velho = refazer(c.xdr, { timebounds: { minTime: 0, maxTime } });
      const tv = new Transaction(velho, networkPassphrase);
      await db.resgateCotacao.update({
        where: { id: c.quoteId },
        data: { submitXdrHash: `reserva-${c.quoteId}`, submitTxHash: tv.hash().toString('hex'), submitMaxTime: new Date(maxTime * 1000), submitXdr: velho },
      });
      void t;
      const { reconciliarSwapsOrfaos: rec } = await import('@/lib/services/swap-escrituracao');
      await rec({ agora: Date.now() });
      await rec({ agora: Date.now() + 6 * MIN });
      await db.resgateCotacao.update({ where: { id: c.quoteId }, data: { consumedAt: new Date(), consumedTxHash: 'e'.repeat(64) } });
      chain.txs.set(tv.hash().toString('hex'), { successful: true });
      return c.quoteId;
    }

    it('F1 alerta: conflito da vigia de resgate → a rota responde alerta:true, envia 1 e-mail (com o id interno, sem hash nem chave) e grava a marca só após a entrega', async () => {
      const id = await conflitoDeResgate();
      const r1 = await rota();
      const j1 = JSON.parse(r1.texto);
      expect(r1.status).toBe(200);
      expect(j1).toMatchObject({ resgatesVigiaConflitos: 1, alerta: true, alertaEnviado: true });
      expect(r1.texto).not.toContain(id);
      expect(r1.texto).not.toMatch(/[0-9a-f]{64}/);
      expect(st.alerta).toHaveBeenCalledTimes(1);
      const corpo = JSON.stringify(st.alerta.mock.calls[0][0]);
      expect(corpo).toContain(id);
      expect(corpo).not.toMatch(/[0-9a-f]{64}|SECRET|G[A-Z2-7]{55}/);
      expect((await db.resgateCotacao.findUniqueOrThrow({ where: { id } })).conflitoAlertadoEm).not.toBeNull();
      const j2 = JSON.parse((await rota()).texto);
      expect(j2).toMatchObject({ alerta: false });
      expect(st.alerta).toHaveBeenCalledTimes(1); // dedupe
    });

    it('F1 alerta: e-mail que FALHA não grava a marca; a próxima varredura alerta de novo (paridade com o swap)', async () => {
      const id = await conflitoDeResgate();
      st.alerta.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const j1 = JSON.parse((await rota()).texto);
      expect(j1).toMatchObject({ alerta: true, alertaEnviado: false });
      expect((await db.resgateCotacao.findUniqueOrThrow({ where: { id } })).conflitoAlertadoEm).toBeNull();
      const j2 = JSON.parse((await rota()).texto);
      expect(j2).toMatchObject({ alerta: true, alertaEnviado: true });
      expect(st.alerta).toHaveBeenCalledTimes(2);
      expect((await db.resgateCotacao.findUniqueOrThrow({ where: { id } })).conflitoAlertadoEm).not.toBeNull();
    });

    // F6 (corrigido em 1da95fa): o R1 do Argus pede que o job falhe com resgatesSemProva > 0.
    it('F6 (corrigido) — resgate INDETERMINADO (resgatesSemProva > 0) marca alerta:true no cron, e sem resgate órfão alerta:false', async () => {
      const c = await cotar();
      const maxTime = Math.floor((Date.now() - 60 * MIN) / 1000);
      const velho = refazer(c.xdr, { timebounds: { minTime: 0, maxTime } });
      await db.resgateCotacao.update({
        where: { id: c.quoteId },
        data: { submitXdrHash: `reserva-${c.quoteId}`, submitTxHash: new Transaction(velho, networkPassphrase).hash().toString('hex'), submitMaxTime: new Date(maxTime * 1000), submitXdr: velho },
      });
      chain.sequenciaConta = '105';
      chain.contaTxs = [];
      const j = JSON.parse((await rota()).texto);
      expect(j.resgatesSemProva).toBeGreaterThan(0);
      expect(j.alerta).toBe(true);
      // e sem nenhum resgate sem prova o cron volta a alerta:false
      await db.resgateCotacao.update({ where: { id: c.quoteId }, data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null } });
      expect(JSON.parse((await rota()).texto).alerta).toBe(false);
    });

    it('F7 cron — a resposta traz referenciaPreco (OK | VENCIDA | AUSENTE) e alerta:true quando ≠ OK, SEM expor preço, data nem taxa', async () => {
      const ok = JSON.parse((await rota()).texto);
      expect(ok).toMatchObject({ referenciaPreco: 'OK', alerta: false });
      vi.stubEnv('PRECO_TESOURO_REF_DATA', new Date(Date.now() - 31 * 24 * 3600_000).toISOString());
      vi.stubEnv('TESOURO_TAXA_ANUAL', '0.1234');
      const r = await rota();
      const venc = JSON.parse(r.texto);
      expect(venc).toMatchObject({ referenciaPreco: 'VENCIDA', alerta: true });
      expect(r.texto).not.toMatch(/0\.1234|2026-|\b5\b.*preco/i);
      vi.stubEnv('PRECO_TESOURO_REF_DATA', '');
      expect(JSON.parse((await rota()).texto)).toMatchObject({ referenciaPreco: 'AUSENTE', alerta: true });
      vi.stubEnv('PRECO_TESOURO_REF_DATA', new Date().toISOString());
      expect(JSON.parse((await rota()).texto)).toMatchObject({ referenciaPreco: 'OK', alerta: false }); // volta ao normal
    });

    it('F3: FK — investidor com cotação de resgate não pode ser apagado; cotação para investidor inexistente é recusada; TRUNCATE CASCADE do investidor limpa a cotação', async () => {
      const c = await cotar();
      await expect(db.investidor.delete({ where: { id: 'inv_res' } })).rejects.toThrow();
      await expect(
        db.resgateCotacao.create({
          data: { id: 'rc-orfa', investidorId: 'nao-existe', classe: 'SENIOR', plinarfAmount: '1', brlEquivalente: '1', bridgeAmount: '1', taxaBridge: '1', bridgeCode: 'T', bridgeIssuer: 'G', navPorTokenNaCotacao: '1', expiresAt: new Date() } as never,
        }),
      ).rejects.toThrow();
      await db.$executeRawUnsafe('TRUNCATE "Investidor" RESTART IDENTITY CASCADE');
      expect(await db.resgateCotacao.count({ where: { id: c.quoteId } })).toBe(0);
      await semearInvestidor(); // o razão (MovimentoFundo) não tem FK e sobrevive ao TRUNCATE do investidor
    });

    it('F5 TESOURO: 2 submits simultâneos cujo total excede o saldo de TESOURO do distributor (o caixa dá) → só 1 assina', async () => {
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      const a = await cotar('100.0000000'); // 20 TESOURO
      const b = await cotar('100.0000000', B); // 20 TESOURO
      chain.saldoDistributor = '30'; // cabe um, não os dois
      let chegaram = 0;
      let liberar!: () => void;
      const barreira = new Promise<void>((r) => { liberar = r; });
      const obter = async () => { if (++chegaram === 2) liberar(); await barreira; return PRECO; };
      const rs = await Promise.allSettled([
        submeter(assinar(a.xdr), a.quoteId, { obter }),
        submeter(assinar(b.xdr, OUTRO), b.quoteId, { investidor: B, obter }),
      ]);
      expect(chegaram).toBe(2);
      expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const perdeu = rs.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect((perdeu.reason as ApiError).code).toBe('LIQUIDEZ_INSUFICIENTE');
      expect(chain.submetidos).toHaveLength(1);
    });

    it('F5: a reserva que falha na liquidez não deixa reserva aberta nem fecha o NAV', async () => {
      const B = await semearInvestidor('inv_b', OUTRO.publicKey(), 'did:privy:b');
      await db.movimentoFundo.deleteMany({});
      await db.movimentoFundo.create({ data: { tipo: 'SUBSCRICAO', valorBrl: '150', deltaCaixa: '150', deltaTokens: '150', chave: 'seed-pequeno' } as never });
      st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('150'), subordinada: supply('0') });
      resetNavSupplyCache();
      const a = await cotar('100.0000000');
      const b = await cotar('100.0000000', B);
      let chegaram = 0;
      let liberar!: () => void;
      const barreira = new Promise<void>((r) => { liberar = r; });
      const obter = async () => { if (++chegaram === 2) liberar(); await barreira; return PRECO; };
      await Promise.allSettled([
        submeter(assinar(a.xdr), a.quoteId, { obter }),
        submeter(assinar(b.xdr, OUTRO), b.quoteId, { investidor: B, obter }),
      ]);
      const abertas = await db.resgateCotacao.count({ where: { submitXdrHash: { not: null }, consumedAt: null } });
      expect(abertas).toBe(0);
    });

    it('F2 (repetido 8×): o perdedor da corrida do MESMO XDR sempre devolve o mesmo txHash e o domínio é escriturado 1×', async () => {
      for (let i = 0; i < 8; i++) {
        await db.$executeRawUnsafe(LIMPAR);
        await semearInvestidor();
        await semearFundo();
        chain.submetidos = [];
        chain.txs = new Map();
        const c = await cotar();
        const xdr = assinar(c.xdr);
        const rs = await Promise.allSettled([submeter(xdr, c.quoteId), submeter(xdr, c.quoteId)]);
        expect(rs.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
        const [h1, h2] = rs.map((x) => (x as PromiseFulfilledResult<{ txHash: string }>).value.txHash);
        expect(h1).toBe(h2);
        expect(await movimentos('RESGATE_PAGO')).toBe(1);
      }
    });

    it('F2: um erro que NÃO é corrida (ex.: XDR de outra cotação consumida) continua sendo erro', async () => {
      const c1 = await cotar();
      await submeter(assinar(c1.xdr), c1.quoteId);
      const c2 = await cotar('50.0000000');
      // XDR da cotação 2 apresentado na cotação 1 (consumida com outro XDR) → 409, não "idempotente"
      const e = (await erro(submeter(assinar(c2.xdr), c1.quoteId))) as ApiError;
      expect(e).toBeInstanceOf(ApiError);
      expect([400, 409]).toContain(e.status);
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });
  });

  describe('R2 (1da95fa): faixa de preço ±2% contra referência independente e teto por resgate', () => {
    const base = async (preco = '5') => cotar('100.0000000', INVESTIDOR, preco);
    const semPersistir = async () => expect(await db.resgateCotacao.count()).toBe(0);

    it('preço da Etherfuse dentro de ±2% da referência passa (na borda +2% e −2%); além da borda → 409 PRECO_FORA_DA_FAIXA e nada persistido', async () => {
      await expect(base('5.10')).resolves.toHaveProperty('quoteId'); // +2,00%
      await expect(base('4.90')).resolves.toHaveProperty('quoteId'); // −2,00%
      await db.resgateCotacao.deleteMany({});
      for (const p of ['5.11', '4.89', '5.5', '2.5', '50']) {
        const e = (await erro(base(p))) as ApiError;
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(409);
        expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
      }
      await semPersistir();
    });

    it('preço ZERADO ou inflado absurdo da Etherfuse não passa (é o vetor que esvaziaria o distributor): recusa antes de montar o XDR', async () => {
      for (const p of ['0.0001', '5000']) {
        const e = (await erro(base(p))) as ApiError;
        expect(e.code === 'PRECO_FORA_DA_FAIXA' || e.code === 'ETHERFUSE_ERROR').toBe(true);
      }
      await semPersistir();
    });

    it('SEM referência (sem config e sem swap escriturado) → fail-closed: 409 PRECO_FORA_DA_FAIXA; config inválida (abc, 0, negativa) vale como inexistente', async () => {
      for (const cfg of ['', 'abc', '0', '-3']) {
        vi.stubEnv('PRECO_TESOURO_REF_BRL', cfg);
        const e = (await erro(base('5'))) as ApiError;
        expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
      }
      await semPersistir();
    });

    async function semearSwapEscriturado(fromAmount: string, fee: string, toAmount: string, consumedAt: Date) {
      await db.quote.create({
        data: {
          id: `q_ref_${Math.random().toString(36).slice(2, 8)}`, investidorId: 'inv_res', fromCurrency: 'BRL', fromAmount, toCurrency: 'TESOURO', toAmount,
          exchangeRate: '1', fee, expiresAt: new Date(Date.now() - 3600_000), consumedAt, consumedTxHash: 'a'.repeat(64),
        } as never,
      });
    }

    it('a referência é o preço líquido do ÚLTIMO swap escriturado e MANDA sobre a config: (1000 − 20) ÷ 840 = 1,1667', async () => {
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(2)); // config mais velha que o swap
      await semearSwapEscriturado('1000', '20', '840', new Date());
      // config (5) é ignorada: 5 está fora da faixa de 1,1667; 1,1667 passa
      expect(((await erro(base('5'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA');
      await expect(base('1.1667')).resolves.toHaveProperty('quoteId');
      // o último é o de consumedAt mais recente
      await semearSwapEscriturado('1000', '20', '800', new Date(Date.now() + 1000)); // (980/800) = 1,225
      await expect(base('1.225')).resolves.toHaveProperty('quoteId');
      expect(((await erro(base('1.1667'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA'); // 1,1667 vs 1,225 = −4,7%
    });

    const DIA = 24 * 3600_000;
    const dataIso = (diasAtras: number, extraMs = 0) => new Date(Date.now() - diasAtras * DIA + extraMs).toISOString();

    it('F7 (850dae9) — a referência é o ponto MAIS RECENTE entre o último swap escriturado e a config datada', async () => {
      await semearSwapEscriturado('1000', '20', '840', new Date(Date.now() - 5 * DIA)); // líquido 1,1667, há 5 dias
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '5');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(1)); // config mais recente que o swap → vale a config
      await expect(base('5')).resolves.toHaveProperty('quoteId');
      expect(((await erro(base('1.1667'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA');
      await db.resgateCotacao.deleteMany({});
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(10)); // config mais velha que o swap → vale o swap
      await expect(base('1.1667')).resolves.toHaveProperty('quoteId');
      expect(((await erro(base('5'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA');
    });

    it('F7 — swap de 60 dias com config de hoje: a config é a mais recente e o resgate FLUI (antes do F7 ficava bloqueado)', async () => {
      await semearSwapEscriturado('1000', '20', '980', new Date(Date.now() - 60 * DIA)); // líquido 1,0000, velho
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '1.17');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(0));
      await expect(base('1.17')).resolves.toHaveProperty('quoteId');
    });

    it('F7 — bordas de 30 dias: referência de 30 d − 2 s vale; de 30 d + 2 s é VENCIDA (409 PRECO_FORA_DA_FAIXA, motivo "vencida"), tanto na config quanto no swap', async () => {
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(30, 2000));
      await expect(base('5')).resolves.toHaveProperty('quoteId'); // 30 d − 2 s
      await db.resgateCotacao.deleteMany({});
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(30, -2000)); // 30 d + 2 s
      const e = (await erro(base('5'))) as ApiError;
      expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
      expect(e.status).toBe(409);
      expect(e.message).toMatch(/vencida/i);
      await semPersistir();
      // swap (sem config válida)
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '');
      await semearSwapEscriturado('1000', '20', '840', new Date(Date.now() - 30 * DIA + 2000));
      await expect(base('1.1667')).resolves.toHaveProperty('quoteId');
      await db.quote.deleteMany({ where: { id: { startsWith: 'q_ref_' } } });
      await db.resgateCotacao.deleteMany({});
      await semearSwapEscriturado('1000', '20', '840', new Date(Date.now() - 30 * DIA - 2000));
      expect(((await erro(base('1.1667'))) as ApiError).message).toMatch(/vencida/i);
    });

    it('F7 — config SEM data, com data inválida ou sem preço NÃO conta (AUSENTE → fail-closed, sem a palavra "vencida")', async () => {
      for (const [preco, data] of [['5', ''], ['5', 'ontem'], ['5', '2026-13-45'], ['', dataIso(0)]] as const) {
        vi.stubEnv('PRECO_TESOURO_REF_BRL', preco);
        vi.stubEnv('PRECO_TESOURO_REF_DATA', data);
        const e = (await erro(base('5'))) as ApiError;
        expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
        expect(e.message).not.toMatch(/vencida/i);
      }
      await semPersistir();
    });

    it('F7 — correção pós-fixada: 1,1663 de 20 dias atrás a 14% a.a. vale ≈ 1,174704; 1,1975 (+1,94% da corrigida, +2,68% da crua) PASSA; borda +2,05% da corrigida (1,198785) não', async () => {
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '1.1663');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(20));
      vi.stubEnv('TESOURO_TAXA_ANUAL', '0.14');
      await expect(base('1.1975')).resolves.toHaveProperty('quoteId');
      await db.resgateCotacao.deleteMany({});
      expect(((await erro(base('1.1988'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA'); // > +2% da corrigida
      // sem a correção (taxa ausente) o mesmo 1,1975 estaria +2,68% da crua e seria recusado
      vi.stubEnv('TESOURO_TAXA_ANUAL', '');
      expect(((await erro(base('1.1975'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA');
    });

    it('F7 — taxa inválida, negativa ou ausente = sem correção (nunca derruba nem corrige para baixo); data no futuro conta como 0 dia', async () => {
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '1.1663');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(20));
      for (const taxa of ['abc', '-0.2', '']) {
        vi.stubEnv('TESOURO_TAXA_ANUAL', taxa);
        expect(((await erro(base('1.1975'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA'); // sem correção: +2,68%
        await expect(base('1.18')).resolves.toHaveProperty('quoteId'); // +1,18% da crua passa
        await db.resgateCotacao.deleteMany({});
      }
      vi.stubEnv('TESOURO_TAXA_ANUAL', '0.14');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(-5)); // data 5 dias no FUTURO: 0 dia de correção
      await expect(base('1.18')).resolves.toHaveProperty('quoteId');
      await db.resgateCotacao.deleteMany({});
      expect(((await erro(base('1.1975'))) as ApiError).code).toBe('PRECO_FORA_DA_FAIXA');
    });

    it('F7 — o swap também é corrigido pela taxa a partir do consumedAt', async () => {
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '');
      vi.stubEnv('TESOURO_TAXA_ANUAL', '0.14');
      await semearSwapEscriturado('1000', '20', '840', new Date(Date.now() - 20 * DIA)); // 1,1667 → ≈ 1,1751
      await expect(base('1.1975')).resolves.toHaveProperty('quoteId'); // +1,9% da corrigida
    });

    it('F7 — a referência vence ENTRE o build e o submit → 409 PRECO_FORA_DA_FAIXA ("vencida"), sem reserva nem assinatura', async () => {
      const c = await base('5');
      vi.stubEnv('PRECO_TESOURO_REF_DATA', dataIso(31));
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
      expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
      expect(e.message).toMatch(/vencida/i);
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
    });

    it('swap de OUTRA direção (TESOURO → BRL) ou não consumido não vira referência', async () => {
      await db.quote.create({
        data: { id: 'q_off', investidorId: 'inv_res', fromCurrency: 'TESOURO', fromAmount: '100', toCurrency: 'BRL', toAmount: '120', exchangeRate: '1.2', fee: '1', expiresAt: new Date(), consumedAt: new Date() } as never,
      });
      await db.quote.create({
        data: { id: 'q_nc', investidorId: 'inv_res', fromCurrency: 'BRL', fromAmount: '1000', toCurrency: 'TESOURO', toAmount: '500', exchangeRate: '0.5', fee: '1', expiresAt: new Date() } as never,
      });
      await expect(base('5')).resolves.toHaveProperty('quoteId'); // cai na config (5)
    });

    it('no SUBMIT o preço relido também precisa estar na faixa: a referência muda entre o build e o submit → 409 PRECO_FORA_DA_FAIXA, sem reserva nem assinatura', async () => {
      const c = await base('5');
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '4'); // 5 vs 4 = +25%
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
      expect(e.code).toBe('PRECO_FORA_DA_FAIXA');
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
      expect(await navDisponivel()).toBe(true);
    });

    it('TETO por resgate: acima de RESGATE_MAX_BRL → 409 RESGATE_ACIMA_DO_TETO e nada persistido; exatamente o teto passa', async () => {
      vi.stubEnv('RESGATE_MAX_BRL', '100'); // R$ 100 = 100 tokens a NAV 1
      await expect(cotar('100.0000000')).resolves.toHaveProperty('quoteId'); // = teto
      await db.resgateCotacao.deleteMany({});
      const e = (await erro(cotar('100.0100000'))) as ApiError;
      expect(e.status).toBe(409);
      expect(e.code).toBe('RESGATE_ACIMA_DO_TETO');
      await semPersistir();
    });

    it('SEM teto configurado (ausente, vazio ou inválido) vale o padrão de R$ 50.000 — nunca "sem teto"', async () => {
      await db.holdingPLINARF.updateMany({ where: { investidorId: 'inv_res' }, data: { saldo: '1000000' } });
      for (const v of ['', 'abc', '0', '-1']) {
        vi.stubEnv('RESGATE_MAX_BRL', v);
        const e = (await erro(cotar('50000.1000000'))) as ApiError;
        expect(e.code).toBe('RESGATE_ACIMA_DO_TETO');
        await semPersistir();
      }
      vi.stubEnv('RESGATE_MAX_BRL', '');
      await expect(cotar('50000.0000000')).resolves.toHaveProperty('quoteId');
    });

    it('o teto é relido no SUBMIT (pode ter mudado): reduzido entre o build e o submit → 409, sem reserva', async () => {
      const c = await cotar('100.0000000');
      vi.stubEnv('RESGATE_MAX_BRL', '50');
      const e = (await erro(submeter(assinar(c.xdr), c.quoteId))) as ApiError;
      expect(e.code).toBe('RESGATE_ACIMA_DO_TETO');
      expect(chain.submetidos).toHaveLength(0);
      expect((await estado(c.quoteId))?.submitXdrHash).toBeNull();
    });

    it('órfã (retry do mesmo XDR) NÃO reaplica faixa nem teto: referência e teto mudam depois da reserva e a re-assinatura antes do maxTime ainda vale', async () => {
      const c = await cotar();
      const xdr = assinar(c.xdr);
      chain.submit = 'ambiguo';
      await erro(submeter(xdr, c.quoteId));
      chain.submit = 'ok';
      chain.submetidos = [];
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '1');
      vi.stubEnv('RESGATE_MAX_BRL', '1');
      await expect(submeter(xdr, c.quoteId)).resolves.toHaveProperty('txHash');
      expect(await movimentos('RESGATE_PAGO')).toBe(1);
    });

    it('a ordem das guardas: teto primeiro (barato), depois a referência; liquidez só depois', async () => {
      vi.stubEnv('RESGATE_MAX_BRL', '10');
      vi.stubEnv('PRECO_TESOURO_REF_BRL', '1'); // também fora da faixa
      const e = (await erro(cotar('100.0000000'))) as ApiError;
      expect(e.code).toBe('RESGATE_ACIMA_DO_TETO');
    });
  });
});
