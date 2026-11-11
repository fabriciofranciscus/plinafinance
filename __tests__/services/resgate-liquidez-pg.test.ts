/**
 * Liquidez do resgate sob concorrência REAL no Postgres (condição de merge do Atlas, E2-6).
 *
 * Só roda com um Postgres descartável em TEST_PG_URL (localhost; migrations aplicadas):
 *   TEST_PG_URL=postgresql://user@127.0.0.1:5432/plina_test pnpm vitest run __tests__/services/resgate-liquidez-pg.test.ts
 * Sem a variável o arquivo é pulado. Recusa host que não seja local: nunca roda contra o Neon.
 * O Stellar é simulado; o banco (advisory lock, reserva, razão do fundo) é de verdade.
 */
import { Account, Asset, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return url;
});

const st = vi.hoisted(() => ({
  assinados: [] as string[],
  submits: [] as string[],
  saldoTesouro: '1000.0000000',
}));

vi.mock('@/lib/services/liquidacao', async () => {
  const { Prisma: P } = await import('@prisma/client');
  return {
    calcularPrecoDeResgate: vi.fn(async () => ({
      navPorToken: new P.Decimal('1.00000000'),
      brlEquivalente: new P.Decimal('100.00'),
      navTotal: 1,
      tokensVivos: 1,
    })),
  };
});
vi.mock('@/lib/stellar/account', () => ({
  // Atraso para as DUAS chamadas lerem o saldo e passarem na checagem solta antes de qualquer reserva.
  getAssetBalance: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return st.saldoTesouro;
  }),
}));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));
vi.mock('@/lib/stellar/signer', () => ({ distributorSigner: () => ({}) }));
vi.mock('@/lib/stellar/transactions', () => ({
  fetchTransactionByHash: vi.fn(async () => null),
  preSignWithSigner: vi.fn((_s: unknown, xdr: string) => {
    st.assinados.push(xdr);
    return { pubkey: process.env.STELLAR_DISTRIBUTOR_PUBLIC, sigBase64: 'sig' };
  }),
  submitWithPrivySignature: vi.fn(async (a: { xdr: string }) => {
    st.submits.push(a.xdr);
    await new Promise((r) => setTimeout(r, 30));
    return { hash: `tx_${a.xdr.slice(-12)}` }; // determinístico por envelope (mesmo XDR → mesmo hash, como na rede)
  }),
}));

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { networkPassphrase } from '@/lib/stellar/config';
import { submeterResgate } from '@/lib/services/resgate';
import { memoHashDoResgate } from '@/lib/services/regras-resgate';
import { caixaDoFundo, registrarMovimentoFundo } from '@/lib/services/razao-fundo';

const ISSUER = Keypair.random();
const DIST = Keypair.random();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const D = (v: string) => new Prisma.Decimal(v);

function investidor(i: number) {
  const kp = Keypair.random();
  return { kp, row: { id: `inv_${i}`, nome: `Inv ${i}`, email: `inv${i}@exemplo.test`, publicKey: kp.publicKey(), privyId: `did:privy:${i}` } };
}

function envelope(kp: Keypair, quoteId: string) {
  const tx = new TransactionBuilder(new Account(kp.publicKey(), '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: kp.publicKey(), destination: ISSUER.publicKey(), asset: new Asset('PLINARF', ISSUER.publicKey()), amount: '100' }))
    .addOperation(Operation.payment({ source: DIST.publicKey(), destination: kp.publicKey(), asset: TESOURO, amount: '80' }))
    .setTimebounds(0, Math.floor(Date.now() / 1000) + 100)
    .addMemo(Memo.hash(memoHashDoResgate(quoteId)))
    .build();
  tx.sign(kp);
  return tx;
}

async function semear(n: number, caixa: string) {
  const invs = Array.from({ length: n }, (_, i) => investidor(i + 1));
  for (const x of invs) await db.investidor.create({ data: x.row });
  await db.$transaction((tx) =>
    registrarMovimentoFundo(tx, { tipo: 'SUBSCRICAO', valorBrl: caixa, tokens: '1000', chave: 'seed-caixa' }),
  );
  const cots = [];
  for (const [i, x] of invs.entries()) {
    const id = `rq_${i + 1}`;
    await db.resgateCotacao.create({
      data: {
        id, investidorId: x.row.id, classe: 'SENIOR', plinarfAmount: D('100'), brlEquivalente: D('100.00'),
        bridgeAmount: D('80'), taxaBridge: '1.25', bridgeCode: 'TESOURO', bridgeIssuer: TESOURO.getIssuer(),
        navPorTokenNaCotacao: D('1'), expiresAt: new Date(Date.now() + 300_000),
      },
    });
    cots.push({ id, inv: x, tx: envelope(x.kp, id) });
  }
  return cots;
}

const submeter = (c: Awaited<ReturnType<typeof semear>>[number]) =>
  submeterResgate({
    investidor: { id: c.inv.row.id, publicKey: c.inv.row.publicKey, privyId: c.inv.row.privyId },
    quoteId: c.id,
    signedXdr: c.tx.toXDR(),
    obterPrecoTesouroBrl: async () => '1.25',
  });

describe.skipIf(!PG)('resgate — liquidez sob concorrência real no Postgres', () => {
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
    process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST.publicKey();
    process.env.RESGATE_PRECO_TESOURO_REF = '1.25'; // referência independente (faixa ±2%)
    delete process.env.RESGATE_TETO_BRL;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.assinados = []; st.submits = []; st.saldoTesouro = '1000.0000000';
    await db.$executeRawUnsafe('TRUNCATE "ResgateCotacao", "MovimentoFundo", "EventoAudit", "Investidor" RESTART IDENTITY CASCADE');
  });

  it('2 submits simultâneos de 100 BRL com caixa 150: só UM assina e envia; o outro leva 409 LIQUIDEZ_INSUFICIENTE', async () => {
    const [a, b] = await semear(2, '150.00');
    const r = await Promise.allSettled([submeter(a), submeter(b)]);
    const ok = r.filter((x) => x.status === 'fulfilled');
    const ko = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ code: 'LIQUIDEZ_INSUFICIENTE', status: 409 });
    expect(st.assinados).toHaveLength(1); // a Plina assinou UMA vez
    expect(st.submits).toHaveLength(1);
    const cots = await db.resgateCotacao.findMany({ orderBy: { id: 'asc' } });
    expect(cots.filter((c) => c.submitXdrHash)).toHaveLength(1); // só uma reserva
    expect(cots.filter((c) => c.consumedAt)).toHaveLength(1);
    expect((await caixaDoFundo()).toFixed(2)).toBe('50.00'); // 150 − 100, nunca negativo
  });

  it('2 submits simultâneos que CABEM juntos (caixa 250): os dois passam', async () => {
    const [a, b] = await semear(2, '250.00');
    const r = await Promise.allSettled([submeter(a), submeter(b)]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(st.submits).toHaveLength(2);
    expect((await caixaDoFundo()).toFixed(2)).toBe('50.00');
  });

  it('TESOURO: saldo 100 do distributor e 2 resgates de 80 simultâneos → só um', async () => {
    st.saldoTesouro = '100.0000000';
    const [a, b] = await semear(2, '1000.00');
    const r = await Promise.allSettled([submeter(a), submeter(b)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const ko = r.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ko?.reason).toMatchObject({ code: 'LIQUIDEZ_INSUFICIENTE' });
    expect(st.submits).toHaveLength(1);
  });

  it('MESMO XDR submetido 2× em paralelo: escritura 1× e os dois recebem o MESMO txHash (idempotente, Vera F2)', async () => {
    const [a] = await semear(1, '500.00');
    const r = await Promise.allSettled([submeter(a), submeter(a)]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    const [h1, h2] = r.map((x) => (x as PromiseFulfilledResult<{ txHash: string }>).value.txHash);
    expect(h1).toBe(h2);
    expect(await db.eventoAudit.count({ where: { acao: 'PLINARF_LIQUIDADO' } })).toBe(1);
    expect((await caixaDoFundo()).toFixed(2)).toBe('400.00'); // baixou UMA vez
  });

  it('o lock é solto no fim: depois do 409, um resgate menor ainda passa (a transação não ficou presa)', async () => {
    const [a, b] = await semear(2, '150.00');
    await Promise.allSettled([submeter(a), submeter(b)]);
    const [perdedor] = (await db.resgateCotacao.findMany({ where: { consumedAt: null } }));
    await db.resgateCotacao.update({ where: { id: perdedor.id }, data: { plinarfAmount: D('40'), brlEquivalente: D('40.00'), bridgeAmount: D('32') } });
    const c = [a, b].find((x) => x.id === perdedor.id)!;
    const tx = new TransactionBuilder(new Account(c.inv.kp.publicKey(), '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: c.inv.kp.publicKey(), destination: ISSUER.publicKey(), asset: new Asset('PLINARF', ISSUER.publicKey()), amount: '40' }))
      .addOperation(Operation.payment({ source: DIST.publicKey(), destination: c.inv.kp.publicKey(), asset: TESOURO, amount: '32' }))
      .setTimebounds(0, Math.floor(Date.now() / 1000) + 100)
      .addMemo(Memo.hash(memoHashDoResgate(c.id)))
      .build();
    tx.sign(c.inv.kp);
    await expect(submeter({ ...c, tx })).resolves.toMatchObject({ txHash: expect.any(String) });
    expect((await caixaDoFundo()).toFixed(2)).toBe('10.00');
  });
});
