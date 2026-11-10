import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { NavMudouError } from '@/lib/services/emissao';
import { NavIndisponivelError } from '@/lib/services/nav-supply';

const USER_PK = Keypair.random().publicKey();
const OTHER_PK = Keypair.random().publicKey();

const {
  quoteFindUnique,
  quoteUpdateMany,
  investidorUpdate,
  eventoAuditCreate,
  movimentoCreateMany,
  holdingUpsert,
  buildSwapBridgeForPlinarfXdr,
  preSignWithSigner,
  issueAsset,
  revalidarNav,
  issuerSigner,
  distributorSigner,
  buildAsset,
  resolveTesouroAsset,
  assertElegivelParaTrustline,
  loadAccount,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  holdingUpsert: vi.fn(),
  buildSwapBridgeForPlinarfXdr: vi.fn(),
  preSignWithSigner: vi.fn(),
  issueAsset: vi.fn(),
  revalidarNav: vi.fn(),
  issuerSigner: vi.fn(() => ({ id: 'issuer' })),
  distributorSigner: vi.fn(() => ({ id: 'distributor' })),
  buildAsset: vi.fn(),
  resolveTesouroAsset: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  loadAccount: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/wallet/auth-guard')>();
  return {
    ...actual, // mantém AuthError real (withApi precisa dele)
    // Lazy: USER_PK só é lido na chamada (request time), não no hoist do vi.mock.
    requireInvestidor: vi.fn(() =>
      Promise.resolve({
        privyId: 'did:privy:abc',
        investidorId: 'inv_1',
        publicKey: USER_PK,
        email: 'x@y.z',
        etherfuseCustomerId: 'cust_1',
      }),
    ),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: quoteFindUnique },
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

vi.mock('@/lib/stellar/transactions', () => ({
  buildSwapBridgeForPlinarfXdr,
  preSignWithSigner,
}));
vi.mock('@/lib/stellar/issuer', () => ({ issueAsset, createTrustline: vi.fn() }));
vi.mock('@/lib/services/emissao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/emissao')>();
  return { ...actual, revalidarNavDaCotacao: revalidarNav };
});
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner, distributorSigner }));
vi.mock('@/lib/stellar/account', () => ({ buildAsset, loadAccount }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));

process.env.STELLAR_ISSUER_PUBLIC = 'GISSUER';
process.env.STELLAR_ISSUER_SECRET = 'SISS';
process.env.STELLAR_DISTRIBUTOR_SECRET = 'SDIST';
process.env.STELLAR_DISTRIBUTOR_PUBLIC = 'GDIST';

import { POST } from '@/app/api/investidor/buy/swap/build/route';

function req(body: object): Request {
  return new Request('http://x/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
    investidor: { publicKey: USER_PK },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: { __mock: true },
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
  issueAsset.mockReset().mockResolvedValue({ hash: 'tx_mock_hash' });
  revalidarNav.mockReset().mockResolvedValue(undefined);
  buildSwapBridgeForPlinarfXdr.mockReset();
  preSignWithSigner.mockReset();
  buildAsset.mockReset().mockReturnValue({});
  resolveTesouroAsset.mockReset();
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/investidor/buy/swap/build', () => {
  it('400 sem campos obrigatórios', async () => {
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(400);
  });

  it('403 quando investorPubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: OTHER_PK }));
    expect(r.status).toBe(403);
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(403);
  });

  it('409 quote já consumido', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ consumedAt: new Date() }));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(409);
  });

  it('200 mock path executa a emissão (issuer) + audit log', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.data.mock).toBe(true);
    expect(json.data.alreadyExecuted).toBe(true);
    expect(json.data.txHash).toBe('tx_mock_hash');
    expect(issueAsset).toHaveBeenCalledOnce();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(true);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });

  it('409 quando o quote não tem preço de emissão (legado) — nunca cai em 1:1', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({ plinarfAmount: null, navPorTokenNaCotacao: null }),
    );
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(409);
    expect(issueAsset).not.toHaveBeenCalled();
    expect(buildSwapBridgeForPlinarfXdr).not.toHaveBeenCalled();
  });

  it('mock path emite o PLINARF do quote, não o TESOURO (NAV 1,0625)', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        fromAmount: new Prisma.Decimal('400'),
        toAmount: new Prisma.Decimal('344'),
        navPorTokenNaCotacao: new Prisma.Decimal('1.0625'),
        plinarfAmount: new Prisma.Decimal('376.4705882'),
      }),
    );
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(200);
    // E2-5: o BRL integralizado (fromAmount) entra no caixa com os q tokens emitidos.
    const mov = movimentoCreateMany.mock.calls[0][0].data[0];
    expect(mov.tipo).toBe('SUBSCRICAO');
    expect(mov.valorBrl.toFixed(2)).toBe('400.00');
    expect(mov.deltaCaixa.toFixed(2)).toBe('400.00');
    expect(mov.deltaTokens.toFixed(7)).toBe('376.4705882');
    expect(mov.chave).toBe('subscricao:q_1');
    expect(issueAsset.mock.calls[0][2]).toBe('376.4705882');
    expect(issueAsset.mock.calls[0][0]).toEqual({ id: 'issuer' }); // N1: emite o issuer, não o distributor
    expect(issueAsset.mock.calls[0][1]).toBe(USER_PK);
    expect(issueAsset.mock.calls[0][4].memoHash).toHaveLength(32);
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.amount).toBe('376.4705882');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.navPorTokenNaCotacao).toBe('1.06250000');
  });

  it('real path: perna ponte = toAmount e perna PLINARF = plinarfAmount (valores distintos)', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        toAmount: new Prisma.Decimal('344'),
        navPorTokenNaCotacao: new Prisma.Decimal('1.0625'),
        plinarfAmount: new Prisma.Decimal('376.4705882'),
        onRampOrder: { id: 'ord_1', status: 'completed', paymentInstructionsJson: {} },
      }),
    );
    resolveTesouroAsset.mockResolvedValueOnce({ code: 'TESOURO', issuer: 'GTES', identifier: 'TESOURO:GTES' });
    loadAccount.mockResolvedValueOnce({ balances: [{ asset_code: 'TESOURO', asset_issuer: 'GTES' }] });
    buildSwapBridgeForPlinarfXdr.mockResolvedValueOnce({ xdr: 'XDR', hashHex: '0xabc' });
    preSignWithSigner.mockReturnValueOnce({ sigBase64: 'sig', pubkey: 'GISSUER' });
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(200);
    const args = buildSwapBridgeForPlinarfXdr.mock.calls[0][0];
    expect(args.bridgeAmount).toBe('344.0000000');
    expect(args.plinarfAmount).toBe('376.4705882');
    // N1 + L1-S1/S3: o build NÃO assina nada pela Plina (nem issuer nem distributor) e
    // não devolve assinatura nem chave pública; a Plina assina só no submit.
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(issuerSigner).not.toHaveBeenCalled();
    const data = (await r.json()).data;
    expect(data).toEqual({ xdr: 'XDR', hashHex: '0xabc', mock: false });
    // o distributor segue só como destino da perna ponte
    expect(args.distributorPubkey).toBe('GDIST');
    expect(args.issuerPubkey).toBe('GISSUER');
  });

  it('N1: o caminho real não precisa do segredo do issuer (só o mock emite no build)', async () => {
    const saved = process.env.STELLAR_ISSUER_SECRET;
    delete process.env.STELLAR_ISSUER_SECRET;
    try {
      quoteFindUnique.mockResolvedValueOnce(baseQuote({ onRampOrder: { id: 'ord_1', status: 'completed', paymentInstructionsJson: {} } }));
      resolveTesouroAsset.mockResolvedValueOnce({ code: 'TESOURO', issuer: 'GTES', identifier: 'TESOURO:GTES' });
      loadAccount.mockResolvedValueOnce({ balances: [{ asset_code: 'TESOURO', asset_issuer: 'GTES' }] });
      buildSwapBridgeForPlinarfXdr.mockResolvedValueOnce({ xdr: 'XDR', hashHex: '0xabc' });
      const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
      expect(r.status).toBe(200);
      // o mock path, que emite pelo issuer, recusa sem o segredo e não emite
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r2 = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
      expect(r2.status).toBe(500);
      expect(issueAsset).not.toHaveBeenCalled();
    } finally {
      process.env.STELLAR_ISSUER_SECRET = saved;
    }
  });

  it('L1-S2: NAV mudou além de 1 bp → 409 NAV_MUDOU, nada é montado nem emitido', async () => {
    revalidarNav.mockRejectedValueOnce(new NavMudouError());
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('NAV_MUDOU');
    expect(issueAsset).not.toHaveBeenCalled();
    expect(buildSwapBridgeForPlinarfXdr).not.toHaveBeenCalled();
  });

  it('L1-S2: o build relê o NAV com o BRL e o NAV congelados da cotação', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(revalidarNav.mock.calls[0][0].fromAmount.toFixed(2)).toBe('100.00');
    expect(revalidarNav.mock.calls[0][0].navPorTokenNaCotacao.toFixed(2)).toBe('1.00');
  });

  it('L1-S2: sem NAV (ledger fora / PLINARFB) → 503 LEDGER_UNAVAILABLE constante', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revalidarNav.mockRejectedValueOnce(new NavIndisponivelError('LEDGER_LEITURA_FALHOU', { cause: new Error('ENOTFOUND horizon') }));
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error.code).toBe('LEDGER_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/ENOTFOUND|horizon/i);
    expect(issueAsset).not.toHaveBeenCalled();
  });

  it('L1-S2: o quote expira mesmo com o onramp completed (410)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ expiresAt: new Date(Date.now() - 1_000) }));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(410);
    expect(issueAsset).not.toHaveBeenCalled();
    expect(revalidarNav).not.toHaveBeenCalled();
  });
});
