import { describe, expect, it, vi } from 'vitest';
import { ASAAS_SANDBOX_BASE, criarAsaasProvider } from '@/lib/integrations/psp/asaas';
import { PspError } from '@/lib/integrations/psp/types';

const KEY = 'chave-secreta-asaas-0123456789';
const PIX = 'cliente-a00001@pix.bcb.gov.br';
const ENVIO = { valor: '123.45', chavePix: PIX, tipoChave: 'EMAIL' as const, idempotencyKey: 'pix-cedente:cessao_1' };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const prov = (f: typeof fetch) => criarAsaasProvider({ apiKey: KEY, fetch: f, timeoutMs: 200 });
const falha = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as PspError | null;

describe('Asaas — configuração (só sandbox, por código)', () => {
  it('sem chave da API → PSP_CONFIG', () => {
    expect(() => criarAsaasProvider({ apiKey: '', fetch: vi.fn() })).toThrow(expect.objectContaining({ code: 'PSP_CONFIG' }));
  });
  it.each(['https://api.asaas.com', 'https://api-sandbox.asaas.com.evil.com', 'http://api-sandbox.asaas.com', 'https://localhost'])(
    'base %s (não é o sandbox) → PSP_CONFIG',
    (baseUrl) => {
      expect(() => criarAsaasProvider({ apiKey: KEY, baseUrl, fetch: vi.fn() })).toThrow(expect.objectContaining({ code: 'PSP_CONFIG' }));
    },
  );
  it('base do sandbox (com barra no fim) é aceita', () => {
    expect(() => criarAsaasProvider({ apiKey: KEY, baseUrl: `${ASAAS_SANDBOX_BASE}/`, fetch: vi.fn() })).not.toThrow();
  });
});

describe('Asaas — enviarPix', () => {
  it('POST /v3/transfers no sandbox, access_token no header, corpo no formato da doc, externalReference = idempotencyKey', async () => {
    const f = vi.fn(async () => json({ id: 'tra_1', status: 'PENDING', externalReference: ENVIO.idempotencyKey }));
    const r = await prov(f as never).enviarPix(ENVIO);
    expect(r).toEqual({ id: 'tra_1', status: 'PENDENTE' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-sandbox.asaas.com/v3/transfers');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).access_token).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      value: 123.45, pixAddressKey: PIX, pixAddressKeyType: 'EMAIL', operationType: 'PIX',
      description: 'Pagamento Plina', externalReference: 'pix-cedente:cessao_1',
    });
  });

  it.each([
    ['valor sem 2 casas', { ...ENVIO, valor: '1.5' }],
    ['valor zero', { ...ENVIO, valor: '0.00' }],
    ['tipo de chave inválido', { ...ENVIO, tipoChave: 'CELULAR' as never }],
    ['idempotencyKey curta', { ...ENVIO, idempotencyKey: 'x' }],
    ['campo extra (strict)', { ...ENVIO, extra: 1 } as never],
  ])('entrada inválida (%s) → PSP_RECUSOU sem tocar na rede', async (_n, entrada) => {
    const f = vi.fn();
    expect((await falha(prov(f as never).enviarPix(entrada as never)))?.code).toBe('PSP_RECUSOU');
    expect(f).not.toHaveBeenCalled();
  });

  it('4xx → PSP_RECUSOU (nada saiu)', async () => {
    expect((await falha(prov((async () => json({ errors: [{ description: 'Chave inválida' }] }, 400)) as never).enviarPix(ENVIO)))?.code).toBe('PSP_RECUSOU');
  });
  it.each([500, 502, 429])('HTTP %i → PSP_INCERTO (pode ter saído)', async (status) => {
    expect((await falha(prov((async () => json({}, status)) as never).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
  });
  it('falha de rede e timeout → PSP_INCERTO', async () => {
    expect((await falha(prov((async () => { throw new TypeError('fetch failed'); }) as never).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
    const lento = (async (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as never;
    expect((await falha(prov(lento).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
  });
  it('F-E12-6: o PSP manda os cabeçalhos e trava o CORPO → o timer ainda vale (PSP_INCERTO, não pendura)', async () => {
    const corpoTravado = (async (_u: string, init: RequestInit) =>
      new Response(new ReadableStream({ start(c) { init.signal?.addEventListener('abort', () => c.error(new Error('abort'))); } }), { status: 200 })) as never;
    const t0 = Date.now();
    expect((await falha(prov(corpoTravado).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
    expect(Date.now() - t0).toBeLessThan(3000);
    // na consulta (GET) a mesma trava vira resposta inválida, nunca pendura
    expect((await falha(prov(corpoTravado).consultarStatus('tra_1')))?.code).toBe('PSP_RESPOSTA_INVALIDA');
  });
  it('2xx com corpo ilegível ou status desconhecido depois do POST → PSP_INCERTO (o pedido foi aceito)', async () => {
    expect((await falha(prov((async () => new Response('<html>')) as never).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
    expect((await falha(prov((async () => json({ id: 't', status: 'ALGO_NOVO' })) as never).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
    expect((await falha(prov((async () => json({ status: 'PENDING' })) as never).enviarPix(ENVIO)))?.code).toBe('PSP_INCERTO');
  });
  it('erros não vazam chave Pix, chave da API nem corpo do PSP', async () => {
    const e = await falha(prov((async () => json({ errors: [{ description: `chave ${PIX} ${KEY}` }] }, 400)) as never).enviarPix(ENVIO));
    expect(`${e?.message} ${JSON.stringify(e)}`).not.toMatch(new RegExp(`${PIX}|${KEY}|pix.bcb`));
  });
});

describe('Asaas — consultarStatus', () => {
  const um = (status: string, extra: object = {}) => prov((async () => json({ id: 'tra_1', status, value: 123.45, ...extra })) as never);
  it.each([
    ['PENDING', 'PENDENTE'], ['BANK_PROCESSING', 'PENDENTE'], ['DONE', 'CONCLUIDO'], ['FAILED', 'FALHOU'], ['CANCELLED', 'CANCELADO'],
  ])('%s → %s', async (asaas, esperado) => {
    expect((await um(asaas).consultarStatus('tra_1')).status).toBe(esperado);
  });
  it('traz valor (2 casas), e2eId e data; o motivo da falha vira código constante (texto do PSP pode ter dado bancário)', async () => {
    const r = await um('DONE', { endToEndIdentifier: 'E123', effectiveDate: '2026-11-12' }).consultarStatus('tra_1');
    expect(r).toMatchObject({ valor: '123.45', e2eId: 'E123', efetivadoEm: '2026-11-12', motivoFalha: null });
    const f = await um('FAILED', { failReason: 'Conta 1234-5 do João' }).consultarStatus('tra_1');
    expect(f.motivoFalha).toBe('PSP_FALHA');
  });
  it('status desconhecido → PSP_RESPOSTA_INVALIDA; id com caminho → recusado sem rede', async () => {
    expect((await falha(um('XYZ').consultarStatus('tra_1')))?.code).toBe('PSP_RESPOSTA_INVALIDA');
    const f = vi.fn();
    expect((await falha(prov(f as never).consultarStatus('../accounts')))?.code).toBe('PSP_RECUSOU');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('Asaas — localizarPorChave (a doc não tem idempotência nem filtro por externalReference)', () => {
  const t = (id: string, ref: string | null) => ({ id, status: 'DONE', externalReference: ref });
  it('acha na 2ª página casando externalReference no cliente; filtro por data um dia antes do claim', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ hasMore: true, data: [t('a', 'outra')] }))
      .mockResolvedValueOnce(json({ hasMore: false, data: [t('b', ENVIO.idempotencyKey)] }));
    const r = await prov(f as never).localizarPorChave(ENVIO.idempotencyKey, new Date('2026-11-12T01:00:00Z'));
    expect(r).toEqual({ id: 'b', status: 'CONCLUIDO' });
    const u1 = decodeURIComponent((f.mock.calls[0] as unknown as [string])[0]);
    expect(u1).toContain('dateCreated[ge]=2026-11-11');
    expect(u1).toContain('offset=0');
    expect(decodeURIComponent((f.mock.calls[1] as unknown as [string])[0])).toContain('offset=100');
  });
  it('não existe → null (só quando a lista acabou)', async () => {
    const f = vi.fn(async () => json({ hasMore: false, data: [t('a', 'outra'), t('b', null)] }));
    expect(await prov(f as never).localizarPorChave(ENVIO.idempotencyKey, new Date())).toBeNull();
  });
  it('mais de 5 páginas sem achar → PSP_RESPOSTA_INVALIDA (não afirma que não existe)', async () => {
    const f = vi.fn(async () => json({ hasMore: true, data: [t('a', 'outra')] }));
    expect((await falha(prov(f as never).localizarPorChave(ENVIO.idempotencyKey, new Date())))?.code).toBe('PSP_RESPOSTA_INVALIDA');
    expect(f).toHaveBeenCalledTimes(5);
  });
});
