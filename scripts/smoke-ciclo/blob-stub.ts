/**
 * Em clone limpo não há token do Vercel Blob. O smoke troca `@vercel/blob` por uma memória local SÓ neste processo
 * (mesma regra do Blob real: privado, sem sobrescrever → "already exists"). Tem de rodar ANTES de importar os serviços.
 * O comprovante que vale continua sendo `TransferenciaPix.comprovante` no banco (bytes hasheados e ancorados).
 */
import Module from 'node:module';

export function instalarBlobEmMemoria(): { arquivos: Map<string, Buffer> } {
  const arquivos = new Map<string, Buffer>();
  const stub = {
    put: async (caminho: string, corpo: Buffer | string, opts: { allowOverwrite?: boolean } = {}) => {
      if (arquivos.has(caminho) && !opts.allowOverwrite) throw new Error('This blob already exists');
      arquivos.set(caminho, Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo));
      return { pathname: caminho, url: `memoria://${caminho}` };
    },
    get: async (caminho: string) => {
      const b = arquivos.get(caminho);
      if (!b) return null;
      return { statusCode: 200, stream: new Response(new Uint8Array(b)).body };
    },
  };
  const M = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
  const original = M._load;
  M._load = function (req: string, ...resto: unknown[]) {
    if (req === '@vercel/blob') return stub;
    return original.call(this, req, ...resto);
  };
  return { arquivos };
}

/**
 * O ativo-ponte TESOURO vem da API da Etherfuse (precisa de chave e rede do anchor). O smoke usa um TESOURO descartável
 * (emissor novo na testnet) e entrega esse resultado no lugar da chamada ao anchor. O resto do swap é o código real.
 */
export function instalarTesouroDescartavel(code: string, issuer: string): void {
  const M = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
  const original = M._load;
  M._load = function (req: string, ...resto: unknown[]) {
    if (/anchors\/etherfuse\/tesouro$/.test(req)) {
      return { resolveTesouroAsset: async () => ({ code, issuer, identifier: `${code}:${issuer}` }) };
    }
    return original.call(this, req, ...resto);
  };
}

/**
 * O DocuSign é uma API externa com conta e consentimento. O smoke troca só as 4 chamadas de rede por um DocuSign simulado
 * neste processo: o envelope guarda o PDF que a Plina gerou e, ao "assinar", devolve os mesmos bytes. O resto (claim do
 * envio, guarda dos bytes, SHA-256, âncora do PDF, transição ASSINADA) é o código real do DS2/DS3.
 */
export function instalarDocusignSimulado(): { envelopes: Map<string, Buffer> } {
  const envelopes = new Map<string, Buffer>();
  const porTransacao = new Map<string, string>();
  let n = 0;
  const M = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
  const original = M._load;
  let modulo: Record<string, unknown> | null = null;
  M._load = function (req: string, ...resto: unknown[]) {
    if (/integrations\/docusign(\/index)?$/.test(req)) {
      if (!modulo) {
        const real = original.call(this, req, ...resto) as Record<string, unknown>;
        modulo = {
          ...real,
          criarEnvelope: async (e: { documentoPdf: Buffer; transactionId: string }) => {
            const existente = porTransacao.get(e.transactionId);
            if (existente) return { envelopeId: existente };
            const envelopeId = `smoke-envelope-${++n}`;
            envelopes.set(envelopeId, Buffer.from(e.documentoPdf));
            porTransacao.set(e.transactionId, envelopeId);
            return { envelopeId };
          },
          buscarEnvelopePorTransactionId: async (t: string) => porTransacao.get(t) ?? null,
          obterStatusEnvelope: async (id: string) => (envelopes.has(id) ? 'concluido' : 'desconhecido'),
          baixarDocumentoAssinado: async (id: string) => {
            const b = envelopes.get(id);
            if (!b) throw new Error('envelope desconhecido');
            return Buffer.from(b);
          },
        };
      }
      return modulo;
    }
    return original.call(this, req, ...resto);
  };
  return { envelopes };
}
