/**
 * Cliente Etherfuse REAL (só `fetch` simulado) no fluxo atual: registro de carteira, conta Pix pela API e ordens com
 * `cryptoWalletId`. Os métodos de aceite de acordos e o presignedUrl saíram do caminho (endpoints removidos/descontinuados).
 */
import { Keypair } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { AnchorError } from '@/lib/anchors/types';

const PK = Keypair.random().publicKey();
const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const cliente = () => new EtherfuseClient({ apiKey: 'chave-de-api', baseUrl: 'https://api.sand.etherfuse.test' });
const corpo = (i = 0) => JSON.parse(String(fetchMock.mock.calls[i]![1].body));
const url = (i = 0) => String(fetchMock.mock.calls[i]![0]);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('registerCustomerWallet', () => {
  it('POST /ramp/customer/{id}/wallet com publicKey e blockchain stellar; devolve o walletId', async () => {
    fetchMock.mockResolvedValue(json(200, { walletId: 'w-1', customerId: 'c-1', publicKey: PK, blockchain: 'stellar' }));
    expect(await cliente().registerCustomerWallet('c-1', PK)).toEqual({ walletId: 'w-1' });
    expect(url()).toBe('https://api.sand.etherfuse.test/ramp/customer/c-1/wallet');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('chave-de-api');
    expect(corpo()).toEqual({ publicKey: PK, blockchain: 'stellar' });
  });
  it('entradas inválidas falham ANTES do fetch (customer vazio, chave que não é Stellar)', async () => {
    await expect(cliente().registerCustomerWallet('', PK)).rejects.toMatchObject({ code: 'MISSING_CUSTOMER_ID', statusCode: 400 });
    await expect(cliente().registerCustomerWallet('c-1', 'GXXX')).rejects.toMatchObject({ code: 'INVALID_PUBLIC_KEY', statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('resposta sem walletId é falha (502), não sucesso silencioso; 404 do upstream sobe como AnchorError', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { customerId: 'c-1' }));
    await expect(cliente().registerCustomerWallet('c-1', PK)).rejects.toMatchObject({ code: 'MISSING_WALLET_ID', statusCode: 502 });
    fetchMock.mockResolvedValueOnce(json(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    await expect(cliente().registerCustomerWallet('c-1', PK)).rejects.toBeInstanceOf(AnchorError);
  });
});

describe('createPixBankAccount', () => {
  it('PF: POST /ramp/customer/{id}/bank-account com a conta e um transactionId gerado; sem presignedUrl no corpo', async () => {
    fetchMock.mockResolvedValue(json(201, { bankAccountId: 'b-1', status: 'active', compliant: true }));
    const r = await cliente().createPixBankAccount('c-1', { pixKey: '52998224725', pixKeyType: 'cpf', firstName: 'Ana', lastName: 'S', cpf: '52998224725' });
    expect(r.bankAccountId).toBe('b-1');
    expect(url()).toBe('https://api.sand.etherfuse.test/ramp/customer/c-1/bank-account');
    expect(corpo().account).toMatchObject({ pixKey: '52998224725', pixKeyType: 'cpf', firstName: 'Ana', cpf: '52998224725' });
    expect(corpo().account.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(corpo())).not.toContain('presignedUrl');
  });
  it('transactionId e bankAccountId informados são preservados', async () => {
    fetchMock.mockResolvedValue(json(201, { bankAccountId: 'b-2', status: 'active' }));
    const conta = { transactionId: 't-1', pixKey: 'x@y.test', pixKeyType: 'email', firstName: 'Ana', lastName: 'S', cpf: '52998224725' };
    await cliente().createPixBankAccount('c-1', conta, 'b-2');
    expect(corpo()).toEqual({ account: conta, bankAccountId: 'b-2' });
  });
  it('customer ausente falha antes do fetch; 409 (customer não aprovado) sobe como AnchorError 409', async () => {
    await expect(cliente().createPixBankAccount('', { pixKey: 'k', pixKeyType: 'email', firstName: 'n', lastName: 's', cpf: '1' })).rejects.toMatchObject({ code: 'MISSING_CUSTOMER_ID' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(json(409, { error: { code: 'ORG_NOT_APPROVED', message: 'x' } }));
    await expect(cliente().createPixBankAccount('c-1', { pixKey: 'k', pixKeyType: 'email', firstName: 'n', lastName: 's', cpf: '1' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('ordens com cryptoWalletId (doc create-order)', () => {
  const ordemOn = { orderId: 'o', onramp: { orderId: 'o', depositClabe: '1', depositAmount: '10', depositBankName: 'b', depositAccountHolder: 'h' } };
  const ordemOff = { orderId: 'o', offramp: { orderId: 'o', withdrawAnchorAccount: 'G', withdrawMemo: 'm', withdrawMemoType: 'text' } };
  const base = { customerId: 'c-1', quoteId: 'q-1', stellarAddress: PK, fromCurrency: 'BRL', toCurrency: 'TESOURO', amount: '10', bankAccountId: 'b-1' };

  it('on-ramp com walletId: /ramp/order leva cryptoWalletId e NÃO leva publicKey; sem walletId cai no publicKey', async () => {
    fetchMock.mockResolvedValue(json(200, ordemOn));
    await cliente().createOnRamp({ ...base, cryptoWalletId: 'w-1' });
    expect(url()).toBe('https://api.sand.etherfuse.test/ramp/order');
    expect(corpo()).toMatchObject({ bankAccountId: 'b-1', cryptoWalletId: 'w-1', quoteId: 'q-1' });
    expect(corpo().publicKey).toBeUndefined();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json(200, ordemOn));
    await cliente().createOnRamp(base);
    expect(corpo().publicKey).toBe(PK);
    expect(corpo().cryptoWalletId).toBeUndefined();
  });
  it('off-ramp igual: cryptoWalletId no lugar de publicKey', async () => {
    fetchMock.mockResolvedValue(json(200, ordemOff));
    await cliente().createOffRamp({ customerId: 'c-1', quoteId: 'q-1', stellarAddress: PK, fromCurrency: 'TESOURO', toCurrency: 'BRL', amount: '10', fiatAccountId: 'b-1', cryptoWalletId: 'w-1' });
    expect(corpo()).toMatchObject({ bankAccountId: 'b-1', cryptoWalletId: 'w-1' });
    expect(corpo().publicKey).toBeUndefined();
  });
});

describe('métodos removidos pela Etherfuse não existem mais no cliente', () => {
  it('sem accept* (endpoints /ramp/agreements/* removidos)', () => {
    const c = cliente() as unknown as Record<string, unknown>;
    for (const n of ['acceptElectronicSignature', 'acceptTermsAndConditions', 'acceptCustomerAgreement', 'acceptAgreements']) expect(c[n], n).toBeUndefined();
  });
});
