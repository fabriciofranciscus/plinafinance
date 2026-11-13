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
