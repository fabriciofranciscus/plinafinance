import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Account, Asset, Memo, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { NavMudouError } from '@/lib/services/emissao';
import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { networkPassphrase } from '@/lib/stellar/config';

const USER = Keypair.random();
const USER_PK = USER.publicKey();
const OTHER_PK = Keypair.random().publicKey();
const DIST_PK = Keypair.random().publicKey();
const ISSUER = Keypair.random();

const {
  quoteFindUnique,
  quoteUpdateMany,
  quoteFindFirst,
  investidorUpdate,
  eventoAuditCreate,
  movimentoCreateMany,
  holdingUpsert,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
  assertElegivelParaTrustline,
  assertSwapXdrMatchesQuote,
  resolveTesouroAsset,
  preSignWithSigner,
  revalidarNav,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  quoteFindFirst: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  holdingUpsert: vi.fn(),
  submitWithPrivySignature: vi.fn(),
  txHashFromXdr: vi.fn(),
  fetchTransactionByHash: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  assertSwapXdrMatchesQuote: vi.fn(),
  resolveTesouroAsset: vi.fn(),
  preSignWithSigner: vi.fn(),
  revalidarNav: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (
    handler: (
      req: Request,
      ctx: { user: Record<string, unknown> },
    ) => Promise<Response>,
  ) =>
    (req: Request) =>
      handler(req, {
        user: {
          privyId: 'did:privy:abc',
          investidorId: 'inv_1',
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: quoteFindUnique, updateMany: quoteUpdateMany, findFirst: quoteFindFirst },
    $transaction: async (
      cb: (tx: {
        quote: { updateMany: typeof quoteUpdateMany };
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
        movimentoFundo: { createMany: typeof movimentoCreateMany };
        holdingPLINARF: { upsert: typeof holdingUpsert };
      }) => Promise<unknown>,
    ) =>
      cb({
        quote: { updateMany: quoteUpdateMany },
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoAuditCreate },
        movimentoFundo: { createMany: movimentoCreateMany },
        holdingPLINARF: { upsert: holdingUpsert },
      }),
  },
}));

// A rota usa txHashFromXdr + fetchTransactionByHash no submit-or-reconcile.
// Mock explícito (nada de importActual) pra manter o teste hermético: o real
// `fetchTransactionByHash` bate no Horizon.
vi.mock('@/lib/stellar/transactions', () => ({
  preSignWithSigner,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({ id: 'issuer' }) }));
vi.mock('@/lib/stellar/fee', () => ({ getDynamicFee: vi.fn().mockResolvedValue('100') }));
vi.mock('@/lib/services/emissao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/emissao')>();
  return { ...actual, revalidarNavDaCotacao: revalidarNav };
});
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));
vi.mock('@/lib/stellar/parse-swap-xdr', () => ({ assertSwapXdrMatchesQuote }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

// N1: as chaves públicas vêm só do env; o ISSUER assina no submit (depois de validar).
process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;

import { POST } from '@/app/api/investidor/buy/swap/submit/route';
import { ApiError } from '@/lib/api/errors';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** XDR real assinado pelo investidor (a rota confere a assinatura dele antes de assinar pela Plina). */
function realTx(amount = '1') {
  return new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount }))
    .setTimeout(0)
    .build();
}
const TX = realTx();
TX.sign(USER);
const ISSUER_SIG = 'issuer-sig-base64';

const FULL_BODY = {
  quoteId: 'q_1',
  signedXdr: TX.toXDR(),
};

/** sha256(hash da tx) — é o que a rota usa como chave de reserva (C-04). */
const XDR_HASH = createHash('sha256').update(TX.hash()).digest('hex');

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    fromAmount: new Prisma.Decimal('100'),
    toAmount: new Prisma.Decimal('99.5'),
    navPorTokenNaCotacao: new Prisma.Decimal('1'),
    plinarfAmount: new Prisma.Decimal('99.5'),
    investidor: { publicKey: 'GABC' },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: {},
    },
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  quoteFindFirst.mockReset().mockResolvedValue(null); // sem outro swap em conferência
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  holdingUpsert.mockReset().mockResolvedValue({});
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_real_hash' });
  txHashFromXdr.mockReset().mockReturnValue('tx_real_hash');
  preSignWithSigner.mockReset().mockReturnValue({ pubkey: ISSUER.publicKey(), sigBase64: ISSUER_SIG });
  revalidarNav.mockReset().mockResolvedValue(undefined);
  fetchTransactionByHash.mockReset().mockResolvedValue(null);
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
  assertSwapXdrMatchesQuote.mockReset();
  resolveTesouroAsset
    .mockReset()
    .mockResolvedValue({
      code: 'TESOURO',
      issuer: 'GTESOURO',
      identifier: 'TESOURO:GTESOURO',
    });
  process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;
});

// ---------------------------------------------------------------------------
// QA Vera — retest F-N1AT-1 (fix/n1-at-trustline-409 @ 0f41c51): a guarda de trustline roda na ROTA antes do envio;
// recusa na 1ª reserva ⇒ reserva liberada + 409 com code. A guarda real lê o Horizon (spy em loadAccount); o envio é o mock.
// ---------------------------------------------------------------------------
import { vi as vitest } from 'vitest';
import { horizon } from '@/lib/stellar/account';
import { TrustlineNaoAutorizadaError } from '@/lib/stellar/trustline';

const PLINARF = new Asset('PLINARF', ISSUER.publicKey());
/** Envelope com a perna de EMISSÃO (source = issuer → investidor) + a perna ponte, assinado pelo investidor, com maxTime vigente. */
function txComEmissao() {
  const t = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
    .addOperation(Operation.payment({ source: ISSUER.publicKey(), destination: USER_PK, asset: PLINARF, amount: '1' }))
    .setTimeout(300)
    .build();
  t.sign(USER);
  return t;
}
const TXI = txComEmissao();
const BODY_I = { quoteId: 'q_1', signedXdr: TXI.toXDR() };
const HASH_I = createHash('sha256').update(TXI.hash()).digest('hex');

const conta = (balances: unknown[]) => Object.assign(new Account(USER_PK, '1'), { balances }) as never;
const linha = (autorizada: boolean | undefined) => ({
  asset_type: 'credit_alphanum12', asset_code: 'PLINARF', asset_issuer: ISSUER.publicKey(), balance: '0', is_authorized: autorizada,
});
const liberou = () =>
  quoteUpdateMany.mock.calls.some((c) => c[0]?.where?.submitXdrHash === HASH_I && c[0]?.data?.submitXdrHash === null);

beforeEach(() => {
  vitest.restoreAllMocks();
  vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(true)]));
});

describe('QA N1-at — swap/submit com a trustline recusada pela guarda (fix 0f41c51)', () => {
  it('trustline revogada, 1º envio: 409 TRUSTLINE_NAO_AUTORIZADA, reserva LIBERADA, nada enviado nem escriturado', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(false)]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
    expect(liberou()).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(investidorUpdate).not.toHaveBeenCalled();
    expect(eventoAuditCreate).not.toHaveBeenCalled();
    expect(movimentoCreateMany).not.toHaveBeenCalled();
  });

  it('sem trustline: 409 TRUSTLINE_AUSENTE + reserva liberada', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRUSTLINE_AUSENTE');
    expect(liberou()).toBe(true);
  });

  it('a liberação é escopada à PRÓPRIA reserva (só a XDR desta tx; só se não consumida) e o 409 não vaza endereço', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(false)]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(BODY_I));
    const txt = JSON.stringify(await r.json());
    expect(txt).not.toContain(USER_PK);
    expect(txt).not.toContain(ISSUER.publicKey());
    const lib = quoteUpdateMany.mock.calls.find((c) => c[0]?.data?.submitXdrHash === null)![0];
    expect(lib.where).toMatchObject({ id: 'q_1', submitXdrHash: HASH_I, consumedAt: null });
  });

  it('a recusa que vem de DENTRO do submitWithPrivySignature (revogou entre as duas leituras) também vira 409 + reserva liberada', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(new TrustlineNaoAutorizadaError('TRUSTLINE_NAO_AUTORIZADA', USER_PK, 'PLINARF:X'));
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
    expect(liberou()).toBe(true);
  });

  it('falha de LEITURA do Horizon na guarda da rota (nada enviado): 500 sem vazar e reserva liberada', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockRejectedValue(new Error('horizon 503 https://h.test/accounts/G...'));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('horizon 503');
    expect(liberou()).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('REENVIO de órfã (mesma XDR, tx fora da chain) com a guarda recusando: 409, mas a reserva FICA (a tx pode já ter entrado)', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(false)]));
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: HASH_I }))
      .mockResolvedValueOnce({ submitXdrHash: HASH_I, consumedTxHash: null, consumedAt: null });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 }); // reserva já existe
    fetchTransactionByHash.mockResolvedValueOnce(null);
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
    expect(liberou()).toBe(false);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('erro do ENVIO à rede (guarda ok): 500 e a reserva FICA (pode ter entrado) — comportamento anterior preservado', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(new Error('timeout no submit'));
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(500);
    expect(liberou()).toBe(false);
  });

  it('retry com a MESMA xdr depois da recusa e da autorização do issuer: reserva nova (count 1), emite uma vez, escritura uma vez', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValueOnce(conta([linha(false)]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    expect((await POST(req(BODY_I))).status).toBe(409);
    expect(liberou()).toBe(true);
    // o issuer autoriza; o mesmo envelope assinado segue
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(true)]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(200);
    expect(submitWithPrivySignature).toHaveBeenCalledTimes(1);
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(movimentoCreateMany).toHaveBeenCalledOnce();
  });

  it('LACUNA residual (INFO, caracterização): se a leitura de DENTRO do submitWithPrivySignature falha com erro comum, a rota não sabe que nada foi à rede — reserva fica aberta (o varredor decide)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(new Error('horizon 503 na 2ª leitura'));
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(500);
    expect(liberou()).toBe(false);
  });

  it('INFO: se a PRÓPRIA liberação falha (banco), o erro da liberação mascara o 409 (500) e a reserva fica — o varredor cobre', async () => {
    vitest.spyOn(horizon, 'loadAccount').mockResolvedValue(conta([linha(false)]));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    quoteUpdateMany.mockResolvedValueOnce({ count: 1 }); // a reserva
    quoteUpdateMany.mockRejectedValueOnce(new Error('db caiu')); // a liberação
    const r = await POST(req(BODY_I));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('db caiu');
  });

  it('XDR sem perna de emissão (só ponte): a guarda não consulta o Horizon e o fluxo normal segue', async () => {
    const spy = vitest.spyOn(horizon, 'loadAccount');
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
