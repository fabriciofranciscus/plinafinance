/**
 * Cliente DocuSign (JWT Grant + eSignature REST v2.1) — só node:crypto + fetch.
 *
 * Fronteira hexagonal: lib/services consome só as funções exportadas por
 * `index.ts`; nenhum SDK de terceiro é importado. Sandbox por padrão
 * (demo.docusign.net / account-d.docusign.com).
 *
 * Segredos e PII: spans e erros carregam só nomes de operação e códigos HTTP;
 * nunca token, chave, corpo de resposta, nome ou e-mail do signatário.
 */

import { createSign } from 'node:crypto';
import { z } from 'zod';
import { withSpan } from '../../observability/tracer';
import { carregarConfigDocusign, type ConfigDocusign, type EnvDocusign } from './config';
import { DocusignConsentRequiredError, DocusignError } from './errors';

const ESCOPO = 'signature impersonation';
const JWT_TTL_SEG = 3600;
const MARGEM_CACHE_MS = 5 * 60_000;
const TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatusEnvelope =
  | 'criado'
  | 'enviado'
  | 'entregue'
  | 'assinado'
  | 'concluido'
  | 'recusado'
  | 'anulado'
  | 'desconhecido';

const STATUS: Record<string, StatusEnvelope> = {
  created: 'criado',
  sent: 'enviado',
  delivered: 'entregue',
  signed: 'assinado',
  completed: 'concluido',
  declined: 'recusado',
  voided: 'anulado',
};

export function normalizarStatusEnvelope(bruto: unknown): StatusEnvelope {
  return typeof bruto === 'string' ? (STATUS[bruto.toLowerCase()] ?? 'desconhecido') : 'desconhecido';
}

const entradaEnvelope = z
  .object({
    documentoPdf: z.instanceof(Buffer),
    nomeDocumento: z.string().trim().min(1).max(200),
    signatario: z
      .object({
        nome: z.string().trim().min(1).max(100),
        email: z.string().trim().max(254).pipe(z.email()),
      })
      .strict(),
    emailSubject: z.string().trim().min(1).max(100),
    /**
     * Chave de idempotência da operação (GUID estável, ex.: `transactionIdDeterministico(cessaoId)`).
     * A DocuSign devolve o MESMO envelope para a mesma transactionId, então repetir a chamada após
     * um resultado incerto (timeout, 5xx) nunca cria outro envelope nem outro e-mail.
     */
    transactionId: z.string().regex(GUID),
    /** Posição do campo de assinatura (pontos, origem no canto superior esquerdo). */
    posicaoAssinatura: z
      .object({
        pagina: z.number().int().min(1).default(1),
        x: z.number().int().min(0).default(72),
        y: z.number().int().min(0).default(700),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CriarEnvelopeInput = z.input<typeof entradaEnvelope>;

export interface ClienteDocusignOpcoes {
  env?: EnvDocusign;
  fetchImpl?: typeof fetch;
  agora?: () => number;
}

function b64url(dados: Buffer | string): string {
  return Buffer.from(dados).toString('base64url');
}

function erroHttp(status: number, contexto: string): DocusignError {
  if (status === 404) {
    return new DocusignError('ENVELOPE_NAO_ENCONTRADO', 'DocuSign: envelope não encontrado.', 404);
  }
  if (status === 401 || status === 403) {
    return new DocusignError(
      'AUTENTICACAO_FALHOU',
      `DocuSign: acesso negado em ${contexto} (HTTP ${status}). Verifique conta, usuário e consentimento da integração.`,
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new DocusignError(
      'INDISPONIVEL',
      `DocuSign indisponível ou limitando requisições em ${contexto} (HTTP ${status}). Tente novamente em instantes.`,
      status,
    );
  }
  return new DocusignError(
    'REQUISICAO_REJEITADA',
    `DocuSign rejeitou a requisição em ${contexto} (HTTP ${status}).`,
    status,
  );
}

function exigirEnvelopeId(id: string): void {
  if (!GUID.test(id)) {
    throw new DocusignError('ENTRADA_INVALIDA', 'DocuSign: envelopeId inválido.');
  }
}

export function criarClienteDocusign(opcoes: ClienteDocusignOpcoes = {}) {
  const agora = opcoes.agora ?? Date.now;
  const doFetch: typeof fetch = (input, init) => (opcoes.fetchImpl ?? fetch)(input, init);

  let config: ConfigDocusign | undefined;
  const cfg = (): ConfigDocusign => (config ??= carregarConfigDocusign(opcoes.env ?? process.env));

  let cache: { token: string; expiraEm: number } | undefined;
  let emVoo: Promise<string> | undefined;

  async function requisitar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new DocusignError('INDISPONIVEL', 'DocuSign: falha de rede ou tempo esgotado. Tente novamente.');
    }
  }

  async function solicitarToken(): Promise<string> {
    const c = cfg();
    const iat = Math.floor(agora() / 1000);
    const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const corpo = b64url(
      JSON.stringify({
        iss: c.integrationKey,
        sub: c.userId,
        aud: c.oauthBase,
        iat,
        exp: iat + JWT_TTL_SEG,
        scope: ESCOPO,
      }),
    );
    const assinatura = createSign('RSA-SHA256')
      .update(`${cabecalho}.${corpo}`)
      .sign(c.chavePrivada)
      .toString('base64url');

    return withSpan('docusign.token', { 'docusign.operacao': 'token_jwt' }, async (span) => {
      const res = await requisitar(`https://${c.oauthBase}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${cabecalho}.${corpo}.${assinatura}`,
        }),
      });
      span.setAttribute('http.status_code', res.status);

      if (!res.ok) {
        // Lê só o código `error` do OAuth; o resto do corpo é descartado.
        const erro = await res
          .json()
          .then((j: unknown) => (j as { error?: unknown })?.error)
          .catch(() => undefined);
        if (erro === 'consent_required') throw new DocusignConsentRequiredError();
        if (res.status === 400 || res.status === 401) {
          throw new DocusignError(
            'AUTENTICACAO_FALHOU',
            'DocuSign: o JWT foi recusado. Confira DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID e a chave privada cadastrada no app.',
            res.status,
          );
        }
        throw erroHttp(res.status, 'obtenção do token');
      }

      const dados = (await res.json().catch(() => null)) as
        | { access_token?: unknown; expires_in?: unknown }
        | null;
      if (!dados || typeof dados.access_token !== 'string' || !dados.access_token) {
        throw new DocusignError('RESPOSTA_INVALIDA', 'DocuSign: resposta de token inesperada.');
      }
      const expiraSeg = typeof dados.expires_in === 'number' ? dados.expires_in : JWT_TTL_SEG;
      cache = { token: dados.access_token, expiraEm: agora() + expiraSeg * 1000 };
      return dados.access_token;
    });
  }

  /** Token em cache até ~5 min antes de expirar; chamadas concorrentes dividem uma só requisição. */
  async function obterToken(): Promise<string> {
    if (cache && agora() < cache.expiraEm - MARGEM_CACHE_MS) return cache.token;
    emVoo ??= solicitarToken().finally(() => {
      emVoo = undefined;
    });
    return emVoo;
  }

  /** Chamada autenticada à API; em 401 descarta o token e tenta uma vez com outro. */
  async function api(
    caminho: string,
    init: RequestInit,
    contexto: string,
  ): Promise<Response> {
    const c = cfg();
    const url = `${c.baseUri}/restapi/v2.1/accounts/${c.accountId}${caminho}`;
    for (let tentativa = 0; ; tentativa++) {
      const token = await obterToken();
      const res = await requisitar(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && tentativa === 0) {
        cache = undefined;
        continue;
      }
      if (!res.ok) throw erroHttp(res.status, contexto);
      return res;
    }
  }

  return {
    /** Pede (ou reaproveita) o token de acesso. Útil para o smoke provar o consentimento. */
    obterToken,

    async criarEnvelope(entrada: CriarEnvelopeInput): Promise<{ envelopeId: string }> {
      const parsed = entradaEnvelope.safeParse(entrada);
      if (!parsed.success) {
        throw new DocusignError('ENTRADA_INVALIDA', 'DocuSign: dados do envelope inválidos.');
      }
      const { documentoPdf, nomeDocumento, signatario, emailSubject, transactionId, posicaoAssinatura } =
        parsed.data;
      if (documentoPdf.length === 0 || documentoPdf.length > MAX_PDF_BYTES || documentoPdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new DocusignError('ENTRADA_INVALIDA', 'DocuSign: o documento deve ser um PDF válido de até 25 MB.');
      }
      const pos = posicaoAssinatura ?? { pagina: 1, x: 72, y: 700 };

      return withSpan('docusign.criar_envelope', { 'docusign.operacao': 'criar_envelope' }, async (span) => {
        await obterToken(); // falha de token acontece antes do POST: não é resultado incerto
        const res = await api(
          '/envelopes',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              emailSubject,
              transactionId,
              status: 'sent',
              documents: [
                {
                  documentId: '1',
                  name: nomeDocumento,
                  fileExtension: 'pdf',
                  documentBase64: documentoPdf.toString('base64'),
                },
              ],
              recipients: {
                signers: [
                  {
                    recipientId: '1',
                    routingOrder: '1',
                    name: signatario.nome,
                    email: signatario.email,
                    tabs: {
                      signHereTabs: [
                        {
                          documentId: '1',
                          pageNumber: String(pos.pagina),
                          xPosition: String(pos.x),
                          yPosition: String(pos.y),
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          },
          'criação do envelope',
        ).catch((e: unknown) => {
          // Rede/timeout/5xx/429 no POST: a DocuSign pode ter criado o envelope. Repetir com a
          // mesma transactionId recupera o envelope existente em vez de criar outro.
          if (e instanceof DocusignError && e.codigo === 'INDISPONIVEL') {
            throw new DocusignError(
              'RESULTADO_INCERTO',
              'DocuSign: não foi possível confirmar se o envelope foi criado. Repita a operação com a MESMA transactionId; ela devolve o envelope já criado, sem duplicar o envio.',
              e.httpStatus,
            );
          }
          throw e;
        });
        span.setAttribute('http.status_code', res.status);
        const dados = (await res.json().catch(() => null)) as { envelopeId?: unknown } | null;
        if (!dados || typeof dados.envelopeId !== 'string' || !GUID.test(dados.envelopeId)) {
          throw new DocusignError('RESPOSTA_INVALIDA', 'DocuSign: resposta de criação de envelope inesperada.');
        }
        return { envelopeId: dados.envelopeId };
      });
    },

    async obterStatusEnvelope(envelopeId: string): Promise<StatusEnvelope> {
      exigirEnvelopeId(envelopeId);
      return withSpan('docusign.status_envelope', { 'docusign.operacao': 'status_envelope' }, async (span) => {
        const res = await api(
          `/envelopes/${envelopeId}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          'consulta do envelope',
        );
        span.setAttribute('http.status_code', res.status);
        const dados = (await res.json().catch(() => null)) as { status?: unknown } | null;
        if (!dados || typeof dados.status !== 'string') {
          throw new DocusignError('RESPOSTA_INVALIDA', 'DocuSign: resposta de status inesperada.');
        }
        return normalizarStatusEnvelope(dados.status);
      });
    },

    /** PDF combinado (documento + certificado de conclusão não incluído). */
    async baixarDocumentoAssinado(envelopeId: string): Promise<Buffer> {
      exigirEnvelopeId(envelopeId);
      return withSpan('docusign.baixar_documento', { 'docusign.operacao': 'baixar_documento' }, async (span) => {
        const res = await api(
          `/envelopes/${envelopeId}/documents/combined`,
          { method: 'GET', headers: { Accept: 'application/pdf' } },
          'download do documento',
        );
        span.setAttribute('http.status_code', res.status);
        const pdf = Buffer.from(await res.arrayBuffer());
        if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
          throw new DocusignError('RESPOSTA_INVALIDA', 'DocuSign: o documento baixado não é um PDF.');
        }
        return pdf;
      });
    },
  };
}

export type ClienteDocusign = ReturnType<typeof criarClienteDocusign>;
