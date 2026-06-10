import { describe, it, expect, vi, beforeEach } from 'vitest';

const { investidorUpdate, eventoCreate, intlEnabled } = vi.hoisted(() => ({
  investidorUpdate: vi.fn(),
  eventoCreate: vi.fn(),
  intlEnabled: vi.fn(),
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
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (
      fn: (tx: {
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoCreate };
      }) => Promise<unknown>,
    ) =>
      fn({
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoCreate },
      }),
  },
}));

vi.mock('@/lib/env/feature-gates', () => ({
  isIntlInvestorFlowEnabled: intlEnabled,
}));

import { POST } from '@/app/api/investidor/entidade/route';

function req(body: object): Request {
  return new Request('http://x/entidade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoCreate.mockReset().mockResolvedValue({});
  intlEnabled.mockReset().mockResolvedValue(false);
});

describe('POST /api/investidor/entidade', () => {
  it('BR: persiste razão social/CNPJ/jurisdição=BR nas colunas', async () => {
    const r = await POST(
      req({
        track: 'BR',
        razaoSocial: 'Família Investimentos LTDA',
        cnpj: '11.222.333/0001-81',
        entityType: 'FAMILY_OFFICE',
        estimatedTicket: '2500000',
        currency: 'BRL',
      }),
    );
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ persisted: true });
    expect(investidorUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: {
        razaoSocial: 'Família Investimentos LTDA',
        cnpj: '11222333000181',
        jurisdicao: 'BR',
      },
    });
    expect(eventoCreate).toHaveBeenCalledOnce();
    const arg = eventoCreate.mock.calls[0]![0] as {
      data: { acao: string };
    };
    expect(arg.data.acao).toBe('ENTIDADE_PREENCHIDA');
  });

  it('BR: 400 com CNPJ inválido (mod-11)', async () => {
    const r = await POST(
      req({
        track: 'BR',
        razaoSocial: 'X LTDA',
        cnpj: '11222333000100',
        entityType: 'FUND',
      }),
    );
    expect(r.status).toBe(400);
    expect(investidorUpdate).not.toHaveBeenCalled();
  });

  it('INTL: 403 quando INTL_INVESTOR_FLOW está off', async () => {
    intlEnabled.mockResolvedValue(false);
    const r = await POST(
      req({
        track: 'INTL',
        razaoSocial: 'Acme Capital Ltd.',
        jurisdicao: 'KY',
        entityType: 'ASSET_MANAGER',
      }),
    );
    expect(r.status).toBe(403);
    expect(investidorUpdate).not.toHaveBeenCalled();
  });

  it('INTL: persiste jurisdição (não-BR) quando flag on', async () => {
    intlEnabled.mockResolvedValue(true);
    const r = await POST(
      req({
        track: 'INTL',
        razaoSocial: 'Acme Capital Ltd.',
        jurisdicao: 'ky',
        entityType: 'ASSET_MANAGER',
      }),
    );
    expect(r.status).toBe(200);
    expect(investidorUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { razaoSocial: 'Acme Capital Ltd.', cnpj: null, jurisdicao: 'KY' },
    });
  });
});
