import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { ApiError } from '@/lib/api/errors';

const USER_PK = Keypair.random().publicKey();
const { submeterResgate, preco } = vi.hoisted(() => ({ submeterResgate: vi.fn(), preco: vi.fn() }));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth:
    (handler: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, {
        user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: USER_PK, email: 'x@y.z', etherfuseCustomerId: 'cust_1' },
      }),
}));
vi.mock('@/lib/services/resgate', () => ({ submeterResgate }));
vi.mock('@/lib/anchors/etherfuse/preco-tesouro', () => ({ obterPrecoLiquidoTesouroBrl: preco }));

import { POST } from '@/app/api/investidor/liquidar/submit/route';

const req = (body: object) =>
  new Request('http://x/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const BODY = { quoteId: 'q_1', signedXdr: 'AAAA'.repeat(30) };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  submeterResgate.mockReset().mockResolvedValue({ txHash: 'tx_resgate' });
  preco.mockReset().mockResolvedValue('1.25');
});

describe('POST /api/investidor/liquidar/submit (E2-6)', () => {
  it('200 { txHash }; o investidor vem da SESSÃO (id, pubkey, privyId), não do body', async () => {
    const r = await POST(req(BODY));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ txHash: 'tx_resgate' });
    expect(submeterResgate).toHaveBeenCalledWith({
      investidor: { id: 'inv_1', publicKey: USER_PK, privyId: 'did:privy:abc' },
      quoteId: 'q_1',
      signedXdr: BODY.signedXdr,
      obterPrecoTesouroBrl: expect.any(Function),
    });
    expect(preco).not.toHaveBeenCalled(); // o preço só é lido (lazy) pelo serviço em reserva nova
  });

  it('o leitor de preço entregue ao serviço usa o cliente Etherfuse da SESSÃO e falha sem cadastro', async () => {
    await POST(req(BODY));
    const { obterPrecoTesouroBrl } = submeterResgate.mock.calls[0][0];
    expect(await obterPrecoTesouroBrl()).toBe('1.25');
    expect(preco).toHaveBeenCalledWith({ customerId: 'cust_1', stellarAddress: USER_PK });
  });

  it('400 com body antigo (pubkey/signatureHex/xdr) ou campo extra (strict), sem chamar o serviço', async () => {
    for (const corpo of [
      { xdr: 'AAAA', pubkey: USER_PK, signatureHex: 'a1b2c3d4' },
      { ...BODY, investidorId: 'inv_outro' },
      { quoteId: 'q_1' },
      {},
    ]) {
      expect((await POST(req(corpo))).status).toBe(400);
    }
    expect(submeterResgate).not.toHaveBeenCalled();
  });

  it.each([
    ['NAV_MUDOU', 409],
    ['COTACAO_EXPIRADA', 410],
    ['SWAP_EM_CONFERENCIA', 409],
    ['CONFLICT', 409],
    ['VALIDATION_FAILED', 400],
    ['NOT_FOUND', 404],
    ['STELLAR_SUBMIT_INCERTO', 504],
    ['PRECO_FORA_DA_FAIXA', 409],
    ['RESGATE_ACIMA_DO_TETO', 409],
    ['LIQUIDEZ_INSUFICIENTE', 409],
  ] as const)('ApiError %s → %s com { error, code }', async (code, status) => {
    submeterResgate.mockRejectedValue(new ApiError(code, status, 'mensagem de negócio'));
    const r = await POST(req(BODY));
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ error: 'mensagem de negócio', code });
  });

  it('a rede recusou: 502 só com title e result_codes do Horizon, sem a mensagem do erro', async () => {
    submeterResgate.mockRejectedValue(
      Object.assign(new Error('Request failed 400 SEGREDO'), {
        response: { data: { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_failed' } } } },
      }),
    );
    const r = await POST(req(BODY));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body).toMatchObject({ code: 'STELLAR_SUBMIT_FAILED', title: 'Transaction Failed', resultCodes: { transaction: 'tx_failed' } });
    expect(JSON.stringify(body)).not.toContain('SEGREDO');
  });

  it('erro comum → 500 fixo, sem vazar a causa', async () => {
    submeterResgate.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await POST(req(BODY));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'erro interno' });
  });
});
