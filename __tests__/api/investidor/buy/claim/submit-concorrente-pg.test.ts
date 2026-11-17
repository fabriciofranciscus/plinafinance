/**
 * claim/submit com Postgres REAL: dois submits simultâneos do MESMO claim gravam UM evento só
 * (pós-tag; LOW (a) do Argus no parecer do claim do TESOURO, adendo 2).
 *
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db pnpm vitest run __tests__/api/investidor/buy/claim/submit-concorrente-pg.test.ts
 * (Postgres local descartável e migrado; recusa host não-local.)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
      throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    }
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

const { mockSubmit, mockFetchByHash, INV_PK } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  mockFetchByHash: vi.fn(),
  INV_PK: { value: '' },
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { user: { privyId: 'did:privy:conc', investidorId: 'inv_conc', publicKey: INV_PK.value } }),
}));

vi.mock('@/lib/stellar/transactions', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/transactions')>()),
  submitWithPrivySignature: mockSubmit,
  fetchTransactionByHash: mockFetchByHash,
}));

vi.mock('@/lib/stellar/claim', async (orig) => {
  const { Asset } = await import('@stellar/stellar-sdk');
  return {
    ...(await orig<typeof import('@/lib/stellar/claim')>()),
    ativoDoClaimableBalance: async () => new Asset('TESOURO', 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4'),
  };
});

import { Account, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { db } from '@/lib/db';
import { networkPassphrase } from '@/lib/stellar/config';
import { txHashFromXdr } from '@/lib/stellar/transactions';
import { POST } from '@/app/api/investidor/buy/claim/submit/route';

const BAL = '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368';

function req(xdr: string): Request {
  return new Request('http://x/claim/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: 'ord-conc', xdr, signatureHex: '0xsig' }),
  });
}

async function semear() {
  await db.investidor.create({
    data: { id: 'inv_conc', nome: 'C', email: 'c@example.com', publicKey: INV_PK.value, kycAprovado: true },
  });
  await db.quote.create({
    data: {
      id: 'q_conc',
      investidorId: 'inv_conc',
      fromCurrency: 'BRL',
      fromAmount: '100',
      toCurrency: 'TESOURO',
      toAmount: '99.5',
      exchangeRate: '0.995',
      fee: '0.5',
      expiresAt: new Date(Date.now() + 3600_000),
    } as never,
  });
  await db.onRampOrder.create({
    data: {
      id: 'ord-conc',
      quoteId: 'q_conc',
      investidorId: 'inv_conc',
      status: 'completed',
      stellarClaimableBalanceId: BAL,
    },
  });
}

const eventosDoClaim = () =>
  db.eventoAudit.count({ where: { acao: 'CLAIMABLE_BALANCE_RESGATADA', investidorId: 'inv_conc' } });

describe.skipIf(!PG)('claim/submit — submits simultâneos, Postgres real', () => {
  let xdr: string;

  beforeEach(async () => {
    INV_PK.value = Keypair.random().publicKey();
    xdr = new TransactionBuilder(new Account(INV_PK.value, '100'), { fee: '100', networkPassphrase })
      .addOperation(Operation.claimClaimableBalance({ balanceId: BAL }))
      .setTimeout(120)
      .build()
      .toXDR();
    await semear();
    mockFetchByHash.mockReset().mockResolvedValue(null);
    // Os dois submits passam pelo Horizon (ex.: reenvio do mesmo envelope devolve o mesmo resultado) e chegam
    // juntos ao commit no banco — o pior caso para a trilha de auditoria.
    mockSubmit.mockReset().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { hash: txHashFromXdr(xdr) };
    });
  });

  afterEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "OnRampOrder", "Quote", "EventoAudit", "Investidor" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('dois submits do mesmo claim ao mesmo tempo → 1 evento só; os dois respondem 200 com o mesmo hash', async () => {
    const [a, b] = await Promise.all([POST(req(xdr)), POST(req(xdr))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const ja = await Promise.all([a.json(), b.json()]);
    expect(ja.map((j) => j.claimTxHash)).toEqual([txHashFromXdr(xdr), txHashFromXdr(xdr)]);
    expect(ja.filter((j) => j.idempotent === true)).toHaveLength(1);
    expect(await eventosDoClaim()).toBe(1);
    const ordem = await db.onRampOrder.findUnique({ where: { id: 'ord-conc' } });
    expect(ordem?.claimTxHash).toBe(txHashFromXdr(xdr));
  });

  it('cinco submits simultâneos → 1 evento só', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => POST(req(xdr))));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await eventosDoClaim()).toBe(1);
  });

  it('OUTRA ordem já resgatada não interfere: a trava é da linha DESTA ordem (ressalva da Vera, mutante OR true)', async () => {
    // Uma 2ª ordem do mesmo investidor, já com claimTxHash. Se a trava lesse outra linha, o submit da 1ª devolveria o
    // hash alheio como idempotente e não gravaria o seu evento.
    await db.quote.create({
      data: {
        id: 'q_outra', investidorId: 'inv_conc', fromCurrency: 'BRL', fromAmount: '50', toCurrency: 'TESOURO',
        toAmount: '49.5', exchangeRate: '0.99', fee: '0.5', expiresAt: new Date(Date.now() + 3600_000),
      } as never,
    });
    // A ordem alheia entra ANTES no heap: a desta compra é apagada e recriada depois dela. Assim um SELECT sem filtro
    // por id (o mutante `OR true`) leria primeiro a linha alheia, com claimTxHash, e o teste pega.
    await db.onRampOrder.delete({ where: { id: 'ord-conc' } });
    await db.onRampOrder.create({
      data: { id: 'ord-outra', quoteId: 'q_outra', investidorId: 'inv_conc', status: 'completed', stellarClaimableBalanceId: BAL, claimTxHash: 'f'.repeat(64) },
    });
    await db.onRampOrder.create({
      data: { id: 'ord-conc', quoteId: 'q_conc', investidorId: 'inv_conc', status: 'completed', stellarClaimableBalanceId: BAL },
    });
    const r = await POST(req(xdr));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.claimTxHash).toBe(txHashFromXdr(xdr));
    expect(j.idempotent).toBeUndefined();
    expect(await eventosDoClaim()).toBe(1);
    expect((await db.onRampOrder.findUnique({ where: { id: 'ord-conc' } }))?.claimTxHash).toBe(txHashFromXdr(xdr));
    expect((await db.onRampOrder.findUnique({ where: { id: 'ord-outra' } }))?.claimTxHash).toBe('f'.repeat(64));
  });

  it('um submit só → 1 evento e claimTxHash gravado (caso de hoje intacto)', async () => {
    const r = await POST(req(xdr));
    expect(r.status).toBe(200);
    expect(await eventosDoClaim()).toBe(1);
  });
});
