/**
 * JSON canônico (RFC 8785, JCS) para os documentos que a Plina hasheia e ancora (snapshot do NAV).
 *
 * Regras: UTF-8, sem espaço, chaves de objeto em ordem crescente de unidades de código UTF-16, strings como
 * `JSON.stringify` (é o que a RFC manda), arrays na ordem dada. Só aceita o que o snapshot usa: null, boolean,
 * string, inteiro seguro, array e objeto simples. Float, NaN/Infinity, `undefined`, bigint e tipos especiais
 * LANÇAM — dinheiro e tokens entram como string decimal, nunca como número, então não há formatação de
 * número ambígua para dois implementadores divergirem.
 */

export class JsonCanonicoError extends Error {
  constructor(motivo: string) {
    super(`JSON não canonicalizável: ${motivo}`);
    this.name = 'JsonCanonicoError';
  }
}

function serializar(valor: unknown, caminho: string): string {
  if (valor === null) return 'null';
  switch (typeof valor) {
    case 'boolean':
      return valor ? 'true' : 'false';
    case 'string':
      return JSON.stringify(valor);
    case 'number':
      if (!Number.isSafeInteger(valor)) throw new JsonCanonicoError(`número não inteiro em ${caminho}`);
      // -0 é inteiro seguro mas JSON.stringify(-0) === '0'; a RFC também serializa como 0.
      return JSON.stringify(valor);
    case 'object': {
      if (Array.isArray(valor)) {
        return `[${valor.map((v, i) => serializar(v, `${caminho}[${i}]`)).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(valor);
      if (proto !== Object.prototype && proto !== null) {
        throw new JsonCanonicoError(`objeto não simples em ${caminho}`);
      }
      const obj = valor as Record<string, unknown>;
      const partes = Object.keys(obj)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${serializar(obj[k], `${caminho}.${k}`)}`);
      return `{${partes.join(',')}}`;
    }
    default:
      throw new JsonCanonicoError(`tipo ${typeof valor} em ${caminho}`);
  }
}

/** Texto canônico (RFC 8785) do valor. */
export function canonicalizar(valor: unknown): string {
  return serializar(valor, '$');
}

/** Bytes UTF-8 do texto canônico — o que se hasheia, publica e ancora. */
export function bytesCanonicos(valor: unknown): Buffer {
  return Buffer.from(canonicalizar(valor), 'utf8');
}
