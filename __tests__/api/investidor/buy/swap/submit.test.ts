import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Account, Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();
const DIST_PK = Keypair.random().publicKey();
const ISSUER = Keypair.random();

const {
  quoteFindUnique,
  quoteUpdateMany,
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
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
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
    quote: { findUnique: quoteFindUnique, updateMany: quoteUpdateMany },
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
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
}));
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));
vi.mock('@/lib/stellar/parse-swap-xdr', () => ({ assertSwapXdrMatchesQuote }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

// N1: as chaves públicas vêm só do env; a assinatura pré-assinada é do ISSUER.
process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;

import { POST } from '@/app/api/investidor/buy/swap/submit/route';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** XDR real (a rota confere a assinatura do issuer contra o hash da tx). */
function realTx() {
  return new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
    .setTimeout(0)
    .build();
}
const TX = realTx();
const ISSUER_SIG = ISSUER.sign(TX.hash()).toString('base64');

const FULL_BODY = {
  quoteId: 'q_1',
  investorPubkey: USER_PK,
  signatureHex: 'deadbeef',
  xdr: TX.toXDR(),
  issuerSigBase64: ISSUER_SIG,
};

/** sha256(FULL_BODY.xdr) — é o que a rota usa como chave de reserva (C-04). */
const XDR_HASH = createHash('sha256').update(FULL_BODY.xdr).digest('hex');

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
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  holdingUpsert.mockReset().mockResolvedValue({});
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_real_hash' });
  txHashFromXdr.mockReset().mockReturnValue('tx_real_hash');
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

describe('POST /api/investidor/buy/swap/submit', () => {
  it('400 faltando campos', async () => {
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(400);
  });

  it('403 investorPubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, investorPubkey: OTHER_PK }));
    expect(r.status).toBe(403);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(403);
  });

  it('409 quando onramp não está completed', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        onRampOrder: { id: 'ord_1', status: 'pending', paymentInstructionsJson: {} },
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
  });

  it('C-04: retry após sucesso com mesmo XDR → 200 idempotente sem re-submit', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: XDR_HASH,
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_prev');
    expect(json.idempotent).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-04: quote consumido com XDR diferente → 409', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: 'hash_de_outra_xdr',
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-01: 400 quando XDR diverge do quote (amount inflado)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    assertSwapXdrMatchesQuote.mockImplementationOnce(() => {
      throw new Error('leg2 amount=999.0000000 ≠ esperado=99.5000000');
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toMatch(/xdr divergente/);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('reserva órfã + tx já on-chain → reconcilia sem re-submeter', async () => {
    quoteFindUnique
      // 1ª leitura: quote ainda não consumido, mas já reservado por esta XDR.
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH }))
      // 2ª leitura (`fresh`, após a reserva falhar): mesma XDR, sem consumedAt.
      .mockResolvedValueOnce({
        submitXdrHash: XDR_HASH,
        consumedTxHash: null,
        consumedAt: null,
      });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 }); // reserva já existe
    fetchTransactionByHash.mockResolvedValueOnce({
      hash: 'tx_ja_onchain',
      successful: true,
    });

    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect((await r.json()).swapTxHash).toBe('tx_ja_onchain');
    // O ponto do reconcile: os tokens já foram mintados, só falta escriturar.
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
  });

  it('reserva órfã + tx falhou on-chain → 409 (pede rebuild)', async () => {
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH }))
      .mockResolvedValueOnce({
        submitXdrHash: XDR_HASH,
        consumedTxHash: null,
        consumedAt: null,
      });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
    fetchTransactionByHash.mockResolvedValueOnce({
      hash: 'tx_falha',
      successful: false,
    });

    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('200 happy path consome quote + incrementa saldo + audit', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_real_hash');
    expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    // C-04: updateMany chamado 2x — reserve (submitXdrHash:null) + consume.
    expect(quoteUpdateMany).toHaveBeenCalledTimes(2);
    expect(quoteUpdateMany.mock.calls[0][0].where.submitXdrHash).toBeNull();
    expect(quoteUpdateMany.mock.calls[1][0].where.consumedAt).toBeNull();
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(false);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });

  it('N1: o issuer do env co-assina; a assinatura vai no extraSignatures com a chave pública do env', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req(FULL_BODY));
    expect(submitWithPrivySignature.mock.calls[0][0].extraSignatures).toEqual([
      { pubkey: ISSUER.publicKey(), sigBase64: ISSUER_SIG },
    ]);
  });

  it('N1: o validador recebe issuer e distributor do ENV, nunca do body', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req(FULL_BODY));
    const expected = assertSwapXdrMatchesQuote.mock.calls[0][1];
    expect(expected.issuerPubkey).toBe(ISSUER.publicKey());
    expect(expected.distributorPubkey).toBe(DIST_PK);
  });

  it('N1: body com distributorPubkey ou distributorSigBase64 (formato antigo) → 400, nada acontece', async () => {
    const velho = { ...FULL_BODY, distributorPubkey: Keypair.random().publicKey(), distributorSigBase64: 'sig==' };
    const r = await POST(req(velho));
    expect(r.status).toBe(400);
    expect(quoteFindUnique).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: assinatura que não é do issuer do env (outra chave ou outra XDR) → 400, sem reservar nem submeter', async () => {
    quoteFindUnique.mockResolvedValue(baseQuote());
    const outraChave = Keypair.random().sign(TX.hash()).toString('base64');
    const r1 = await POST(req({ ...FULL_BODY, issuerSigBase64: outraChave }));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/assinatura do issuer/);

    const outraXdr = new TransactionBuilder(new Account(USER_PK, '2'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '2' }))
      .setTimeout(0).build();
    const sigDaOutraXdr = ISSUER.sign(outraXdr.hash()).toString('base64');
    const r2 = await POST(req({ ...FULL_BODY, issuerSigBase64: sigDaOutraXdr }));
    expect(r2.status).toBe(400);
    const r3 = await POST(req({ ...FULL_BODY, issuerSigBase64: '!!!nao-base64!!!' }));
    expect(r3.status).toBe(400);

    expect(quoteUpdateMany).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: sem as chaves no env → 500 e nada acontece', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    delete process.env.STELLAR_DISTRIBUTOR_PUBLIC;
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });
});
