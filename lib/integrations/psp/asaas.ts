/**
 * Asaas (E1-2) — Pix de saída (`POST /v3/transfers`). SÓ SANDBOX, por código: a base é fixa em
 * `https://api-sandbox.asaas.com`; qualquer outra → `PSP_CONFIG`. A doc oficial NÃO tem idempotência no POST nem
 * filtro por `externalReference`: o serviço nunca reenvia sozinho; `localizarPorChave` casa a `externalReference`
 * (= idempotencyKey) no cliente. Chave da API e chave Pix nunca vão a log nem a erro.
 */
import { z } from 'zod';
import {
  ID_TRANSFERENCIA,
  PspError,
  exigirRedeDeTeste,
  validarEnvio,
  type ConsultaPix,
  type EnvioPix,
  type PixProvider,
  type StatusPix,
} from './types';

export const ASAAS_SANDBOX_BASE = 'https://api-sandbox.asaas.com';
const TIMEOUT_MS = 15_000;
const PAGINAS = 5;
const POR_PAGINA = 100;

const transferencia = z.object({
  id: z.string().min(1),
  status: z.string(),
  value: z.number().optional(),
  endToEndIdentifier: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  failReason: z.string().nullable().optional(),
  externalReference: z.string().nullable().optional(),
});
const lista = z.object({ hasMore: z.boolean().optional(), data: z.array(transferencia) });

const STATUS: Record<string, StatusPix> = {
  PENDING: 'PENDENTE',
  BANK_PROCESSING: 'PENDENTE',
  DONE: 'CONCLUIDO',
  FAILED: 'FALHOU',
  CANCELLED: 'CANCELADO',
};

function mapear(status: string): StatusPix {
  const s = STATUS[status];
  if (!s) throw new PspError('PSP_RESPOSTA_INVALIDA');
  return s;
}

export interface AsaasOpcoes {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function criarAsaasProvider(opts: AsaasOpcoes = {}): PixProvider {
  exigirRedeDeTeste(); // o Asaas daqui é sandbox: nunca em mainnet
  const apiKey = (opts.apiKey ?? process.env.ASAAS_API_KEY ?? '').trim();
  const base = (opts.baseUrl ?? process.env.ASAAS_BASE_URL ?? ASAAS_SANDBOX_BASE).replace(/\/+$/, '');
  if (!apiKey || base !== ASAAS_SANDBOX_BASE) throw new PspError('PSP_CONFIG');
  const f = opts.fetch ?? fetch;

  async function chamar(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<unknown> {
    const ctl = new AbortController();
    // O timer cobre a resposta INTEIRA (cabeçalhos + corpo): um PSP que manda os cabeçalhos e trava o corpo não pendura.
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
    try {
      let resp: Response;
      try {
        resp = await f(`${base}${caminho}`, {
          method: metodo,
          headers: { access_token: apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: ctl.signal,
          redirect: 'error',
        });
      } catch {
        throw new PspError('PSP_INCERTO'); // timeout/rede: pode ter chegado
      }
      // 429 e 5xx: o PSP pode ter processado → incerto. Demais 4xx: recusou antes de processar.
      if (resp.status === 429 || resp.status >= 500) throw new PspError('PSP_INCERTO');
      if (resp.status >= 400) throw new PspError('PSP_RECUSOU');
      try {
        return await resp.json();
      } catch {
        throw new PspError(metodo === 'POST' ? 'PSP_INCERTO' : 'PSP_RESPOSTA_INVALIDA');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function ler(corpo: unknown, aposPost: boolean): z.infer<typeof transferencia> {
    const r = transferencia.safeParse(corpo);
    // Resposta 2xx ilegível depois de um POST: o Pix pode ter saído.
    if (!r.success) throw new PspError(aposPost ? 'PSP_INCERTO' : 'PSP_RESPOSTA_INVALIDA');
    return r.data;
  }

  return {
    nome: 'ASAAS',

    async enviarPix(entrada: EnvioPix) {
      const i = validarEnvio(entrada);
      const t = ler(
        await chamar('POST', '/v3/transfers', {
          value: Number(i.valor),
          pixAddressKey: i.chavePix,
          pixAddressKeyType: i.tipoChave,
          operationType: 'PIX',
          description: i.descricao ?? 'Pagamento Plina',
          externalReference: i.idempotencyKey,
        }),
        true,
      );
      let status: StatusPix;
      try {
        status = mapear(t.status);
      } catch {
        throw new PspError('PSP_INCERTO'); // o pedido foi aceito, mas o status é desconhecido
      }
      return { id: t.id, status };
    },

    async consultarStatus(id: string): Promise<ConsultaPix> {
      if (!ID_TRANSFERENCIA.test(id)) throw new PspError('PSP_RECUSOU');
      const t = ler(await chamar('GET', `/v3/transfers/${id}`), false);
      return {
        id: t.id,
        status: mapear(t.status),
        valor: t.value === undefined ? undefined : t.value.toFixed(2),
        e2eId: t.endToEndIdentifier ?? null,
        efetivadoEm: t.effectiveDate ?? null,
        motivoFalha: t.failReason ? 'PSP_FALHA' : null, // o texto do PSP pode ter dado bancário: não propaga
      };
    },

    async localizarPorChave(idempotencyKey: string, desde: Date) {
      if (Number.isNaN(desde.getTime())) throw new PspError('PSP_RECUSOU');
      // Um dia antes do claim cobre fuso/arredondamento da data (o filtro é por data).
      const dia = new Date(desde.getTime() - 24 * 3_600_000).toISOString().slice(0, 10);
      for (let p = 0; p < PAGINAS; p++) {
        const l = lista.safeParse(
          await chamar('GET', `/v3/transfers?dateCreated%5Bge%5D=${dia}&limit=${POR_PAGINA}&offset=${p * POR_PAGINA}`),
        );
        if (!l.success) throw new PspError('PSP_RESPOSTA_INVALIDA');
        const achada = l.data.data.find((t) => t.externalReference === idempotencyKey);
        if (achada) return { id: achada.id, status: mapear(achada.status) };
        if (!l.data.hasMore) return null;
      }
      // Mais de 5 páginas sem achar: não dá para afirmar que não existe.
      throw new PspError('PSP_RESPOSTA_INVALIDA');
    },
  };
}
