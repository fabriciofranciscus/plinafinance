import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  criarClienteDocusign,
  DocusignConsentRequiredError,
  DocusignError,
  normalizarStatusEnvelope,
  transactionIdDeterministico,
  verificarHmacConnect,
} from '@/lib/integrations/docusign';
import { carregarConfigDocusign } from '@/lib/integrations/docusign/config';

const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = par.privateKey.export({ type: 'pkcs1', format: 'der' }).toString('base64');
const pkcs8 = par.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

const ENV_ID = '11111111-2222-3333-4444-555555555555';
const ENV = {
  DOCUSIGN_INTEGRATION_KEY: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  DOCUSIGN_USER_ID: 'ffffffff-0000-1111-2222-333333333333',
  DOCUSIGN_ACCOUNT_ID: '99999999-8888-7777-6666-555555555555',
  DOCUSIGN_BASE_URI: 'https://demo.docusign.net',
  DOCUSIGN_PRIVATE_KEY: pkcs1,
};
const PDF = Buffer.from('%PDF-1.4\nconteudo de teste\n%%EOF');

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const tokenOk = (expires_in = 3600, access_token = 'tok-1') => json({ access_token, expires_in });

function montar(respostas: Array<Response | (() => Response)>, relogio = { t: 1_700_000_000_000 }) {
  const fetchImpl = vi.fn(async () => {
    const r = respostas.shift();
    if (!r) throw new Error('fetch sem resposta mockada');
    return typeof r === 'function' ? r() : r;
  });
  const cliente = criarClienteDocusign({
    env: ENV,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    agora: () => relogio.t,
  });
  return { cliente, fetchImpl, relogio };
}

const entrada = {
  documentoPdf: PDF,
  nomeDocumento: 'Minuta.pdf',
  signatario: { nome: 'Fulana de Teste', email: 'fulana@example.com' },
  emailSubject: 'Assine a minuta',
  transactionId: transactionIdDeterministico('teste:cessao-1'),
};

describe('config', () => {
  it('aceita chave PKCS#1 e PKCS#8 e remove espaços/quebras', () => {
    const quebrada = pkcs8.replace(/(.{64})/g, '$1\n  ');
    expect(carregarConfigDocusign({ ...ENV, DOCUSIGN_PRIVATE_KEY: pkcs1 }).chavePrivada.type).toBe('private');
    expect(carregarConfigDocusign({ ...ENV, DOCUSIGN_PRIVATE_KEY: quebrada }).chavePrivada.type).toBe('private');
  });

  it('OAUTH_BASE: default só no sandbox; falha fechado nos demais', () => {
    expect(carregarConfigDocusign(ENV).oauthBase).toBe('account-d.docusign.com');
    expect(() => carregarConfigDocusign({ ...ENV, DOCUSIGN_BASE_URI: 'https://na3.docusign.net' })).toThrow(
      /DOCUSIGN_OAUTH_BASE/,
    );
    expect(
      carregarConfigDocusign({
        ...ENV,
        DOCUSIGN_BASE_URI: 'https://na3.docusign.net',
        DOCUSIGN_OAUTH_BASE: 'https://account.docusign.com/',
      }).oauthBase,
    ).toBe('account.docusign.com');
  });

  it('lista só os NOMES das variáveis ausentes e rejeita chave inválida sem vazar o valor', () => {
    const { DOCUSIGN_USER_ID: _u, ...resto } = ENV;
    expect(() => carregarConfigDocusign(resto)).toThrow(/DOCUSIGN_USER_ID/);
    try {
      carregarConfigDocusign({ ...ENV, DOCUSIGN_PRIVATE_KEY: 'lixo-segredo-123' });
      expect.unreachable();
    } catch (e) {
      expect((e as DocusignError).codigo).toBe('CHAVE_PRIVADA_INVALIDA');
      expect((e as Error).message).not.toContain('lixo-segredo-123');
    }
  });

  it('exige https em BASE_URI', () => {
    expect(() => carregarConfigDocusign({ ...ENV, DOCUSIGN_BASE_URI: 'http://demo.docusign.net' })).toThrow(/https/);
  });
});

describe('token JWT', () => {
  it('assina RS256 com os claims certos e usa o host OAuth do sandbox', async () => {
    const { cliente, fetchImpl, relogio } = montar([tokenOk()]);
    expect(await cliente.obterToken()).toBe('tok-1');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://account-d.docusign.com/oauth/token');
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, s] = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toEqual({
      iss: ENV.DOCUSIGN_INTEGRATION_KEY,
      sub: ENV.DOCUSIGN_USER_ID,
      aud: 'account-d.docusign.com',
      iat: relogio.t / 1000,
      exp: relogio.t / 1000 + 3600,
      scope: 'signature impersonation',
    });
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(par.publicKey, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });

  it('reaproveita o cache e renova ~5 min antes de expirar', async () => {
    const { cliente, fetchImpl, relogio } = montar([tokenOk(3600, 'tok-1'), tokenOk(3600, 'tok-2')]);
    expect(await cliente.obterToken()).toBe('tok-1');
    relogio.t += 54 * 60_000; // faltam 6 min: ainda vale
    expect(await cliente.obterToken()).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    relogio.t += 2 * 60_000; // faltam 4 min: renova
    expect(await cliente.obterToken()).toBe('tok-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('chamadas concorrentes dividem uma só requisição de token', async () => {
    const { cliente, fetchImpl } = montar([tokenOk()]);
    const [a, b] = await Promise.all([cliente.obterToken(), cliente.obterToken()]);
    expect([a, b]).toEqual(['tok-1', 'tok-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('consent_required vira erro próprio e acionável, sem vazar o corpo', async () => {
    const { cliente } = montar([json({ error: 'consent_required', error_description: 'segredo-do-corpo' }, 400)]);
    const erro = await cliente.obterToken().catch((e) => e);
    expect(erro).toBeInstanceOf(DocusignConsentRequiredError);
    expect(erro.codigo).toBe('CONSENTIMENTO_NECESSARIO');
    expect(erro.message).toMatch(/consentimento/i);
    expect(erro.message).not.toContain('segredo-do-corpo');
  });

  it('outros erros do OAuth não vazam o corpo', async () => {
    const { cliente } = montar([json({ error: 'invalid_grant', error_description: 'segredo-do-corpo' }, 400)]);
    const erro = await cliente.obterToken().catch((e) => e);
    expect(erro).toBeInstanceOf(DocusignError);
    expect(erro.codigo).toBe('AUTENTICACAO_FALHOU');
    expect(erro.message).not.toContain('segredo-do-corpo');
  });
});

describe('criarEnvelope', () => {
  it('envia por e-mail (status sent, sem clientUserId) e devolve o envelopeId', async () => {
    const { cliente, fetchImpl } = montar([tokenOk(), json({ envelopeId: ENV_ID, status: 'sent' }, 201)]);
    expect(await cliente.criarEnvelope(entrada)).toEqual({ envelopeId: ENV_ID });

    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`https://demo.docusign.net/restapi/v2.1/accounts/${ENV.DOCUSIGN_ACCOUNT_ID}/envelopes`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    const corpo = JSON.parse(init.body as string);
    expect(corpo.status).toBe('sent');
    expect(corpo.emailSubject).toBe('Assine a minuta');
    expect(corpo.transactionId).toBe(entrada.transactionId);
    expect(corpo.documents[0]).toMatchObject({ documentId: '1', fileExtension: 'pdf', documentBase64: PDF.toString('base64') });
    const signer = corpo.recipients.signers[0];
    expect(signer).toMatchObject({ name: 'Fulana de Teste', email: 'fulana@example.com' });
    expect(signer.clientUserId).toBeUndefined();
    expect(signer.tabs.signHereTabs).toHaveLength(1);
  });

  it('rejeita entrada inválida sem chamar a rede', async () => {
    const { cliente, fetchImpl } = montar([]);
    const invalidas = [
      { ...entrada, signatario: { nome: 'X', email: 'nao-e-email' } },
      { ...entrada, documentoPdf: Buffer.from('nao e pdf') },
      { ...entrada, extra: 1 },
      { ...entrada, transactionId: undefined },
      { ...entrada, transactionId: 'nao-e-guid' },
    ];
    for (const i of invalidas) {
      await expect(cliente.criarEnvelope(i as never)).rejects.toMatchObject({ codigo: 'ENTRADA_INVALIDA' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('erro 4xx da API não vaza o corpo nem o e-mail do signatário', async () => {
    const { cliente } = montar([tokenOk(), json({ message: 'fulana@example.com inválido', errorCode: 'X' }, 400)]);
    const erro = await cliente.criarEnvelope(entrada).catch((e) => e);
    expect(erro.codigo).toBe('REQUISICAO_REJEITADA');
    expect(erro.message).not.toContain('fulana');
    expect(erro.message).not.toContain('errorCode');
  });

  it('em 401 renova o token e tenta uma vez', async () => {
    const { cliente, fetchImpl } = montar([
      tokenOk(3600, 'velho'),
      json({}, 401),
      tokenOk(3600, 'novo'),
      json({ envelopeId: ENV_ID }, 201),
    ]);
    await cliente.criarEnvelope(entrada);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [, init] = fetchImpl.mock.calls[3] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer novo');
  });

  it('5xx vira INDISPONIVEL; falha de rede também', async () => {
    const a = montar([tokenOk(), json({}, 503)]);
    await expect(a.cliente.criarEnvelope(entrada)).rejects.toMatchObject({ codigo: 'RESULTADO_INCERTO', httpStatus: 503 });
    const b = montar([
      tokenOk(),
      () => {
        throw new TypeError('fetch failed: detalhe interno');
      },
    ]);
    const erro = await b.cliente.criarEnvelope(entrada).catch((e) => e);
    expect(erro.codigo).toBe('RESULTADO_INCERTO');
    expect(erro.message).not.toContain('detalhe interno');
  });

  it('falha do token antes do POST não é resultado incerto', async () => {
    const { cliente, fetchImpl } = montar([json({}, 503)]);
    await expect(cliente.criarEnvelope(entrada)).rejects.toMatchObject({ codigo: 'INDISPONIVEL' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('idempotência: POST aceito com resposta perdida + reenvio com a mesma transactionId recupera um único envelope', async () => {
    // Fake da DocuSign: dedup por transactionId (mesmo contrato da API real).
    const criados = new Map<string, string>();
    let posts = 0;
    let perderResposta = true;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth/token')) return tokenOk();
      posts++;
      const { transactionId } = JSON.parse(init.body as string);
      if (!criados.has(transactionId)) criados.set(transactionId, ENV_ID);
      if (perderResposta) {
        perderResposta = false;
        throw new TypeError('timeout depois do aceite');
      }
      return json({ envelopeId: criados.get(transactionId) }, 201);
    });
    const cliente = criarClienteDocusign({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });

    const primeira = await cliente.criarEnvelope(entrada).catch((e) => e);
    expect(primeira.codigo).toBe('RESULTADO_INCERTO');
    expect(await cliente.criarEnvelope(entrada)).toEqual({ envelopeId: ENV_ID });

    expect(posts).toBe(2);
    expect(criados.size).toBe(1); // um só envelope (um só e-mail) para a operação
  });
});

describe('transactionIdDeterministico', () => {
  it('é estável, em formato GUID, e muda com a chave', () => {
    const a = transactionIdDeterministico('cessao:1');
    expect(a).toBe(transactionIdDeterministico('cessao:1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(transactionIdDeterministico('cessao:2'));
    expect(() => transactionIdDeterministico('')).toThrow();
  });
});

describe('obterStatusEnvelope', () => {
  it('normaliza o status', async () => {
    const { cliente, fetchImpl } = montar([tokenOk(), json({ status: 'completed' })]);
    expect(await cliente.obterStatusEnvelope(ENV_ID)).toBe('concluido');
    const [url] = fetchImpl.mock.calls[1] as unknown as [string];
    expect(url).toMatch(new RegExp(`/envelopes/${ENV_ID}$`));
  });

  it('mapeia os status conhecidos e cai em desconhecido', () => {
    expect(
      ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'xyz', undefined].map(
        normalizarStatusEnvelope,
      ),
    ).toEqual(['criado', 'enviado', 'entregue', 'assinado', 'concluido', 'recusado', 'anulado', 'desconhecido', 'desconhecido']);
  });

  it('rejeita envelopeId que não é GUID (sem chamar a rede) e trata 404', async () => {
    const a = montar([]);
    await expect(a.cliente.obterStatusEnvelope('../contas')).rejects.toMatchObject({ codigo: 'ENTRADA_INVALIDA' });
    expect(a.fetchImpl).not.toHaveBeenCalled();
    const b = montar([tokenOk(), json({}, 404)]);
    await expect(b.cliente.obterStatusEnvelope(ENV_ID)).rejects.toMatchObject({ codigo: 'ENVELOPE_NAO_ENCONTRADO' });
  });
});

describe('baixarDocumentoAssinado', () => {
  it('devolve o PDF combinado como Buffer', async () => {
    const { cliente, fetchImpl } = montar([tokenOk(), new Response(PDF, { status: 200 })]);
    const pdf = await cliente.baixarDocumentoAssinado(ENV_ID);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.equals(PDF)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/envelopes/${ENV_ID}/documents/combined$`));
    expect((init.headers as Record<string, string>).Accept).toBe('application/pdf');
  });

  it('rejeita resposta que não é PDF', async () => {
    const { cliente } = montar([tokenOk(), new Response('<html>erro</html>', { status: 200 })]);
    await expect(cliente.baixarDocumentoAssinado(ENV_ID)).rejects.toMatchObject({ codigo: 'RESPOSTA_INVALIDA' });
  });
});

describe('verificarHmacConnect', () => {
  const chave = 'chave-hmac-de-teste';
  const corpo = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: ENV_ID } });
  const assinar = (c: string, b: string | Buffer = corpo) => createHmac('sha256', c).update(b).digest('base64');

  it('aceita assinatura válida (string, Buffer, Headers e objeto)', () => {
    const sig = assinar(chave);
    expect(verificarHmacConnect(corpo, { 'X-DocuSign-Signature-1': sig }, chave)).toBe(true);
    expect(verificarHmacConnect(Buffer.from(corpo), { 'x-docusign-signature-1': sig }, chave)).toBe(true);
    expect(verificarHmacConnect(corpo, new Headers({ 'X-DocuSign-Signature-1': sig }), chave)).toBe(true);
  });

  it('aceita se qualquer uma das assinaturas (rotação de chave) for válida', () => {
    expect(
      verificarHmacConnect(
        corpo,
        { 'x-docusign-signature-1': assinar('chave-antiga'), 'x-docusign-signature-2': assinar(chave) },
        chave,
      ),
    ).toBe(true);
  });

  it('rejeita corpo adulterado, chave errada, header ausente, lixo e chave vazia', () => {
    const sig = assinar(chave);
    expect(verificarHmacConnect(corpo + ' ', { 'x-docusign-signature-1': sig }, chave)).toBe(false);
    expect(verificarHmacConnect(corpo, { 'x-docusign-signature-1': assinar('outra') }, chave)).toBe(false);
    expect(verificarHmacConnect(corpo, {}, chave)).toBe(false);
    expect(verificarHmacConnect(corpo, { 'x-docusign-signature-1': 'curta' }, chave)).toBe(false);
    expect(verificarHmacConnect(corpo, { 'x-docusign-signature-1': '' }, chave)).toBe(false);
    expect(verificarHmacConnect(corpo, { 'x-docusign-signature-1': assinar('') }, '')).toBe(false);
  });
});
