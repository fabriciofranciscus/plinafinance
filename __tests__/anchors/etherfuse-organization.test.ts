import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse/client';

const PK = 'GBPXJOSBZLDA6BUPXZXVR3H26KWGOQP774QPWH5OE3KCKQTQFYLGQRVG';
let fetchMock: ReturnType<typeof vi.fn>;

function client() {
  return new EtherfuseClient({ apiKey: 'k', baseUrl: 'https://sandbox.invalid' });
}
function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), body: JSON.parse(init.body as string) };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ organizationId: 'x', displayName: 'n', accountType: 'personal', presigned_url: 'https://p' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EtherfuseClient.createCustomer (organização)', () => {
  it('cria org personal com id gerado por nós e userInfo.email', async () => {
    const c = await client().createCustomer({ email: 'a@b.co', publicKey: PK, name: 'Ana', country: 'BR' });
    const { url, body } = lastCall();
    expect(url).toContain('/ramp/organization');
    expect(url).not.toContain('onboarding-url');
    expect(body).toMatchObject({ id: c.id, accountType: 'personal', userInfo: { email: 'a@b.co' } });
    expect(c.kycStatus).toBe('not_started');
  });

  it('business não envia userInfo (a API rejeita)', async () => {
    await client().createCustomer({ email: 'a@b.co', publicKey: PK, accountType: 'business' });
    expect(lastCall().body).not.toHaveProperty('userInfo');
    expect(lastCall().body.accountType).toBe('business');
  });

  it('exige e-mail', async () => {
    await expect(client().createCustomer({ publicKey: PK })).rejects.toMatchObject({ code: 'MISSING_EMAIL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EtherfuseClient.getKycUrl', () => {
  it('envia userInfo e accountType personal', async () => {
    await client().getKycUrl('c1', PK, 'b1', { email: 'a@b.co', displayName: 'Ana' });
    expect(lastCall().body).toMatchObject({ customerId: 'c1', accountType: 'personal', userInfo: { email: 'a@b.co', displayName: 'Ana' } });
  });
  it('exige e-mail', async () => {
    await expect(client().getKycUrl('c1', PK, 'b1')).rejects.toMatchObject({ code: 'MISSING_EMAIL' });
  });
});
