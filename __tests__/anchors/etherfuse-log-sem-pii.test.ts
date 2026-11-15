/**
 * O cliente Etherfuse não pode logar dado pessoal (Argus, MEDIUM): só método, rota genérica, status e id de correlação.
 * Captura TODA saída de console do cliente (log/error/warn/info/debug) com requisições e respostas cheias de PII.
 */
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { rotaGenerica } from '@/lib/anchors/etherfuse/log';

const EMAIL = 'ana.secreta@exemplo.test';
const PIX = '52998224725';
const NOME = 'Ana Secretíssima';
const PRESIGNED = 'https://sand.etherfuse.test/onb?sig=SEGREDO_ASSINATURA';
const CHAVE_API = 'CHAVE_API_SECRETA';
const CUST = '3f2a9c1e-7b4d-4e8a-9d11-0a1b2c3d4e5f';

let saida: string[];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  saida = [];
  for (const n of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, n).mockImplementation((...a: unknown[]) => { saida.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 6 }))).join(' ')); });
  }
});
afterEach(() => vi.restoreAllMocks());

const cliente = () => new EtherfuseClient({ apiKey: CHAVE_API, baseUrl: 'https://api.sand.etherfuse.test' });
const tudo = () => saida.join('\n');
function semPii() {
  for (const p of [EMAIL, PIX, NOME, 'SEGREDO_ASSINATURA', CHAVE_API, CUST, 'exemplo.test']) expect(tudo(), `vazou ${p}`).not.toContain(p);
}

describe('cliente Etherfuse: log sem PII', () => {
  it('requisição de onboarding com e-mail/nome e resposta com URL assinada: loga método, rota, status e id; nada do corpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { presigned_url: PRESIGNED, email: EMAIL })));
    const url = await cliente().getKycUrl(CUST, 'GABC', 'b1', { email: EMAIL, displayName: NOME });
    expect(url).toBe(PRESIGNED); // o comportamento do cliente não mudou
    semPii();
    expect(tudo()).toMatch(/\[Etherfuse\] POST \/ramp\/onboarding-url id=[0-9a-f]{8}\n\[Etherfuse\] POST \/ramp\/onboarding-url id=[0-9a-f]{8} status=200/);
  });

  it('registro de conta Pix (chave Pix, CPF e nome no corpo; conta na resposta): nada disso aparece', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { bankAccountId: 'bank-1', status: 'active', pixKey: PIX, accountHolderName: NOME })));
    await cliente().registerPixBankAccount(PRESIGNED, { pixKey: PIX, pixKeyType: 'cpf', cpf: PIX, firstName: 'Ana', lastName: NOME } as never);
    semPii();
    expect(tudo()).toContain('/ramp/bank-account');
  });

  it('erro do upstream que ECOA o dado enviado: loga só status e código de máquina, nunca a mensagem nem o corpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { code: 'INVALID_PIX_KEY', message: `chave ${PIX} de ${EMAIL} inválida` } })));
    await expect(cliente().registerPixBankAccount(PRESIGNED, { pixKey: PIX, pixKeyType: 'cpf', cpf: PIX, firstName: 'Ana', lastName: NOME } as never)).rejects.toMatchObject({ code: 'INVALID_PIX_KEY', statusCode: 400 });
    semPii();
    expect(tudo()).toMatch(/\[Etherfuse\] POST \/ramp\/bank-account id=[0-9a-f]{8} status=400 codigo=INVALID_PIX_KEY/);
  });

  it('erro com corpo que não é JSON (texto cru com dado pessoal): não é logado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`falha para ${EMAIL}`, { status: 502 })));
    await expect(cliente().getFiatAccounts(CUST)).rejects.toBeDefined();
    semPii();
    expect(tudo()).toContain('status=502 codigo=UNKNOWN_ERROR');
  });

  it('L1 (HIGH): KYC com nome, nascimento, endereço, documento e imagens base64 de documento e selfie — nada vai ao log, no sucesso e no erro', async () => {
    const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD_IMAGEM_SECRETA';
    const NASC = '1990-05-17';
    const END = 'Rua dos Segredos 123';
    const DOC = '12345678909';
    const ident = { pubkey: 'GABC', identity: { name: { givenName: 'Ana', familyName: NOME }, dateOfBirth: NASC, address: { street: END }, idNumbers: [{ value: DOC }] } };
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { status: 'ok', message: `recebido de ${EMAIL}` })));
    await cliente().submitKycIdentity(CUST, ident as never);
    await cliente().submitKycDocuments(CUST, { pubkey: 'GABC', documentType: 'selfie', images: [{ image: IMG, label: 'selfie' }] } as never);
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { error: { code: 'INVALID_DOC', message: `documento ${DOC} de ${NOME} inválido ${IMG}` } })));
    await expect(cliente().submitKycIdentity(CUST, ident as never)).rejects.toBeDefined();
    await expect(cliente().submitKycDocuments(CUST, { pubkey: 'GABC', documentType: 'document', images: [IMG] } as never)).rejects.toBeDefined();
    for (const p of [IMG, 'data:image', 'base64', 'IMAGEM_SECRETA', NASC, END, DOC, NOME, EMAIL]) expect(tudo(), `vazou ${p}`).not.toContain(p);
    expect(tudo()).toContain('/ramp/customer/:id/kyc/documents');
  });

  it('o id do cliente na rota some: /ramp/customer/<uuid>/bank-accounts → /ramp/customer/:id/bank-accounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { items: [] })));
    await cliente().getFiatAccounts(CUST);
    expect(tudo()).toContain('/ramp/customer/:id/bank-accounts');
    semPii();
  });

  it('simulateFiatReceived / simulateCryptoReceived: sem corpo de resposta nem o orderId no log', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`ordem de ${EMAIL}`, { status: 200 })));
    expect(await cliente().simulateFiatReceived('order-9f8e7d6c-1111-2222-3333-444455556666')).toBe(200);
    expect(await cliente().simulateCryptoReceived('order-9f8e7d6c-1111-2222-3333-444455556666')).toBe(200);
    semPii();
    expect(tudo()).not.toContain('order-9f8e7d6c');
    expect(tudo()).toContain('/ramp/order/fiat_received');
    expect(tudo()).toContain('/ramp/order/crypto_received');
  });
});

describe('rotaGenerica', () => {
  it.each([
    ['/ramp/onboarding-url', '/ramp/onboarding-url'],
    [`/ramp/customer/${CUST}/bank-accounts`, '/ramp/customer/:id/bank-accounts'],
    ['/ramp/quote?x=ana@exemplo.test', '/ramp/quote'],
    ['/ramp/order/ord_123456789/status#frag', '/ramp/order/:id/status'],
  ])('%s → %s', (entrada, esperado) => expect(rotaGenerica(entrada)).toBe(esperado));
});
