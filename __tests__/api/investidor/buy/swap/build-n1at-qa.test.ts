import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { ApiError } from '@/lib/api/errors';
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
  renovarCotacao,
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
  renovarCotacao: vi.fn(),
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
vi.mock('@/lib/services/cotacao-swap', () => ({ renovarCotacaoParaSwap: renovarCotacao }));
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
  // padrão: o preço renovado é o do próprio quote (sem mudança de NAV)
  renovarCotacao.mockReset().mockImplementation(async (q: Record<string, any>) => ({
    id: q.id,
    navPorTokenNaCotacao: q.navPorTokenNaCotacao ?? new Prisma.Decimal('1'),
    plinarfAmount: q.plinarfAmount ?? new Prisma.Decimal('99.5'),
    renovada: false,
  }));
  buildSwapBridgeForPlinarfXdr.mockReset();
  preSignWithSigner.mockReset();
  buildAsset.mockReset().mockReturnValue({});
  resolveTesouroAsset.mockReset();
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
});


// ---------------------------------------------------------------------------
// QA Vera — N1-at no build: buildSwapBridgeForPlinarfXdr lança TrustlineNaoAutorizadaError.
// ---------------------------------------------------------------------------
import { TrustlineNaoAutorizadaError } from '@/lib/stellar/trustline';

function preparaCaminhoReal() {
  quoteFindUnique.mockResolvedValueOnce(
    baseQuote({ onRampOrder: { id: 'ord_1', status: 'completed', paymentInstructionsJson: {} } }),
  );
  resolveTesouroAsset.mockResolvedValueOnce({ code: 'TESOURO', issuer: 'GTES', identifier: 'TESOURO:GTES' });
  loadAccount.mockResolvedValueOnce({ balances: [{ asset_code: 'TESOURO', asset_issuer: 'GTES' }] });
}

describe('QA N1-at — POST swap/build com trustline PLINARF ausente/não autorizada', () => {
  for (const code of ['TRUSTLINE_AUSENTE', 'TRUSTLINE_NAO_AUTORIZADA'] as const) {
    it(`${code}: nada é gravado e o quote continua livre (o build não reserva)`, async () => {
      preparaCaminhoReal();
      buildSwapBridgeForPlinarfXdr.mockRejectedValueOnce(new TrustlineNaoAutorizadaError(code, USER_PK, 'PLINARF:GISSUER'));
      const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
      expect(r.status).not.toBe(200);
      expect(quoteUpdateMany).not.toHaveBeenCalled();
      expect(eventoAuditCreate).not.toHaveBeenCalled();
      expect(issueAsset).not.toHaveBeenCalled();
      expect(preSignWithSigner).not.toHaveBeenCalled();
    });
  }

  it('F-N1AT-2 (retest 0f41c51): 409 com code e mensagem fixa (o front distingue "sem trustline" de "aguardando autorização"); sem endereço no corpo', async () => {
    for (const code of ['TRUSTLINE_AUSENTE', 'TRUSTLINE_NAO_AUTORIZADA'] as const) {
      preparaCaminhoReal();
      buildSwapBridgeForPlinarfXdr.mockRejectedValueOnce(new TrustlineNaoAutorizadaError(code, USER_PK, 'PLINARF:GISSUER'));
      const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
      expect(r.status).toBe(409);
      const j = await r.json();
      expect(j.error.code).toBe(code); // withApi: { error: { code, message } } (o submit, via withAuth, responde { error, code })
      expect(JSON.stringify(j)).not.toContain(USER_PK);
      expect(JSON.stringify(j)).not.toContain('GISSUER');
    }
  });

  it('outro erro do build continua 500 genérico (o mapeamento é só para a recusa tipada)', async () => {
    preparaCaminhoReal();
    buildSwapBridgeForPlinarfXdr.mockRejectedValueOnce(new Error('horizon 503'));
    const r = await POST(req({ quoteId: 'q_1', investorPubkey: USER_PK }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('horizon 503');
  });
});
