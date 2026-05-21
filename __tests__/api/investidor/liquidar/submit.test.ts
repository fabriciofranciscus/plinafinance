import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitLiquidacao } = vi.hoisted(() => ({
  submitLiquidacao: vi.fn(),
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
          publicKey: 'GABC',
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/services/liquidacao', () => ({ submitLiquidacao }));

import { POST } from '@/app/api/investidor/liquidar/submit/route';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const FULL_BODY = {
  xdr: 'AAAA',
  pubkey: 'GABC',
  signatureHex: '0xsig',
  amount: '10',
};

beforeEach(() => {
  submitLiquidacao.mockReset().mockResolvedValue({
    liquidationTxHash: 'tx_liq',
    auditTxHash: 'tx_audit',
    brlEquivalente: 100,
    navPorTokenAtual: 1.0,
  });
});

describe('POST /api/investidor/liquidar/submit', () => {
  it('400 input faltando', async () => {
    const r = await POST(req({ xdr: 'X' }));
    expect(r.status).toBe(400);
  });

  it('403 pubkey ≠ user.publicKey', async () => {
    const r = await POST(req({ ...FULL_BODY, pubkey: 'GOUTRO' }));
    expect(r.status).toBe(403);
  });

  it('200 happy path passa user.investidorId pro service', async () => {
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.liquidationTxHash).toBe('tx_liq');
    expect(submitLiquidacao).toHaveBeenCalledOnce();
    expect(submitLiquidacao.mock.calls[0][0]).toMatchObject({
      investidorId: 'inv_1',
      privyId: 'did:privy:abc',
      investorPubkey: 'GABC',
      amount: '10',
    });
  });

  it('500 quando service lança', async () => {
    submitLiquidacao.mockRejectedValueOnce(new Error('amount inválido'));
    const r = await POST(req({ ...FULL_BODY, amount: 'NaN' }));
    expect(r.status).toBe(500);
  });

  it('NÃO aceita investidorId do body (drop F-05)', async () => {
    // Body com investidorId malicioso é simplesmente ignorado — TypeScript
    // não tipa mais e o service sempre recebe user.investidorId.
    const r = await POST(
      req({ ...FULL_BODY, investidorId: 'inv_OUTRO' as never } as Record<
        string,
        unknown
      >),
    );
    expect(r.status).toBe(200);
    expect(submitLiquidacao.mock.calls[0][0].investidorId).toBe('inv_1');
  });
});
