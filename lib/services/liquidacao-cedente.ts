/**
 * Pagamento ao titular (cedente) por Pix de SAÍDA pelo PSP (E1-2). Contrato: contratos/2026-11-11-e1-2-psp-pix-saida.md.
 *
 * Ordem (DB depois da chain; claim antes de falar com o PSP): claim `TransferenciaPix` → `enviarPix` → consulta →
 * comprovante canônico gravado → espelho no Blob (sem sobrescrever) → `ancorarSha256` (memo = SHA-256 do comprovante)
 * → `COMPROVADA`.
 *
 * O PSP (Asaas) não tem idempotência no POST: este serviço NUNCA reenvia sozinho. Resposta ambígua, ou claim
 * `ENVIANDO` sem `providerId` com lease vencido, vira `INCERTO`, e só se tenta ACHAR a transferência por
 * `externalReference`. FALHOU é terminal (nova tentativa é decisão do operador, fora deste serviço).
 * A chave Pix do titular não é gravada em lugar nenhum: só o destino mascarado. Não toca `Pagamento` nem
 * `EventoAudit` (fiação em `originacao.ts`, Bento).
 */
import { Prisma, type TransferenciaPix } from '@prisma/client';
import { z } from 'zod';
import { db } from '../db';
import { ComprovanteBlobError, guardarComprovantePsp } from '../integrations/blob/comprovante-psp';
import { mascararDestino, montarComprovante } from '../integrations/psp/comprovante';
import { obterPixProvider } from '../integrations/psp';
import { PspError, validarChavePix, type PixProvider, type StatusPix, type TipoChavePix } from '../integrations/psp/types';
import { AncoraError, ancorarSha256 } from '../stellar/ancora';
import { extractSafeError } from '../stellar/log-error';

export const LEASE_PIX_MS = 2 * 60_000;

export type LiquidacaoCedenteErrorCode =
  | 'ENTRADA_INVALIDA'
  | 'VALOR_DIVERGE'
  | 'PROVEDOR_DIVERGE'
  | 'EM_ANDAMENTO'
  | 'COMPROVANTE_FALHOU'
  | 'ANCORA_FALHOU'
  | 'TRANSFERENCIA_NAO_ENCONTRADA'
  | 'NAO_REABRIVEL';

const MENSAGENS: Record<LiquidacaoCedenteErrorCode, string> = {
  ENTRADA_INVALIDA: 'Pagamento ao titular recusado: entrada inválida.',
  VALOR_DIVERGE: 'Pagamento ao titular recusado: o valor difere do já registrado para esta cessão.',
  PROVEDOR_DIVERGE: 'Pagamento ao titular recusado: o provedor difere do já registrado para esta cessão.',
  EM_ANDAMENTO: 'Pagamento ao titular em andamento por outra execução.',
  COMPROVANTE_FALHOU: 'Comprovante do Pix não pôde ser guardado; nada foi ancorado. Repetir é seguro.',
  ANCORA_FALHOU: 'Comprovante do Pix não ancorado na rede; repetir é seguro.',
  TRANSFERENCIA_NAO_ENCONTRADA: 'Nenhum pagamento registrado para esta cessão.',
  NAO_REABRIVEL: 'Só um pagamento com falha confirmada pelo PSP pode ser reaberto.',
};

export class LiquidacaoCedenteError extends Error {
  constructor(readonly code: LiquidacaoCedenteErrorCode, readonly causa?: string, options?: { cause?: unknown }) {
    super(MENSAGENS[code], options);
    this.name = 'LiquidacaoCedenteError';
  }
}

export interface ResultadoPagamento {
  status: 'COMPROVADA' | 'PROCESSANDO' | 'INCERTO' | 'FALHOU';
  transferenciaId?: string;
  sha256?: string;
  txHash?: string;
  motivoFalha?: string;
}

const entrada = z.strictObject({
  cessaoId: z.string().min(1).max(64),
  valor: z.string().regex(/^\d{1,13}\.\d{2}$/).refine((v) => Number(v) > 0),
  chavePix: z.string().min(1).max(140),
  tipoChave: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']),
});

const chaveDaCessao = (cessaoId: string, tentativa = 1) =>
  tentativa === 1 ? `pix-cedente:${cessaoId}` : `pix-cedente:${cessaoId}:${tentativa}`;

interface TentativaAnterior {
  tentativa: number;
  idempotencyKey: string;
  providerId: string | null;
  motivoFalha: string | null;
  reabertaEm: string;
  operador: string;
}
const anteriores = (r: TransferenciaPix): TentativaAnterior[] =>
  Array.isArray(r.historico) ? (r.historico as unknown as TentativaAnterior[]) : [];
/** Chave da tentativa atual + as das anteriores: a recuperação olha TODAS (um envio antigo não pode ficar invisível). */
const todasAsChaves = (r: TransferenciaPix) => [r.idempotencyKey, ...anteriores(r).map((t) => t.idempotencyKey)];
const ehUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

function resultado(r: TransferenciaPix): ResultadoPagamento {
  return {
    status: r.status === 'ENVIANDO' ? 'PROCESSANDO' : r.status,
    transferenciaId: r.providerId ?? undefined,
    sha256: r.comprovanteSha256 ?? undefined,
    txHash: r.ancoraTxHash ?? undefined,
    motivoFalha: r.motivoFalha ?? undefined,
  };
}

async function lease(id: string, agora: Date): Promise<boolean> {
  const r = await db.transferenciaPix.updateMany({
    where: { id, OR: [{ travaAte: null }, { travaAte: { lt: agora } }] },
    data: { travaAte: new Date(agora.getTime() + LEASE_PIX_MS) },
  });
  return r.count === 1;
}

const liberar = (id: string) =>
  db.transferenciaPix.updateMany({ where: { id }, data: { travaAte: null } }).catch(() => undefined);

async function marcar(id: string, data: Prisma.TransferenciaPixUpdateInput): Promise<TransferenciaPix> {
  return db.transferenciaPix.update({ where: { id }, data });
}

function aplicarStatusTerminalRuim(id: string, status: StatusPix, motivo: string) {
  return marcar(id, { status: 'FALHOU', motivoFalha: status === 'CANCELADO' ? 'PSP_CANCELADO' : motivo, travaAte: null });
}

/** Retoma o que dá para retomar, sem nunca reenviar. */
async function avancar(row: TransferenciaPix, provider: PixProvider): Promise<TransferenciaPix> {
  let atual = row;

  // Sem providerId: o envio pode ter saído. Só tenta ACHAR (por externalReference); não reenvia.
  if (!atual.providerId && (atual.status === 'ENVIANDO' || atual.status === 'INCERTO')) {
    let achada: { id: string; status: StatusPix } | null = null;
    try {
      for (const chave of todasAsChaves(atual)) {
        achada = await provider.localizarPorChave(chave, atual.criadoEm);
        if (achada) break;
      }
    } catch (err) {
      if (err instanceof PspError) {
        console.error('[liquidacao-cedente] localizar falhou', err.code);
        return atual.status === 'INCERTO' ? atual : marcar(atual.id, { status: 'INCERTO', motivoFalha: err.code });
      }
      throw err;
    }
    if (!achada) return atual.status === 'INCERTO' ? atual : marcar(atual.id, { status: 'INCERTO', motivoFalha: 'PSP_INCERTO' });
    atual = await marcar(atual.id, { providerId: achada.id, status: 'PROCESSANDO', motivoFalha: null });
  }

  if (atual.status !== 'PROCESSANDO' || !atual.providerId) return atual;

  let c;
  try {
    c = await provider.consultarStatus(atual.providerId);
  } catch (err) {
    if (err instanceof PspError) {
      console.error('[liquidacao-cedente] consulta falhou', err.code);
      return atual; // continua PROCESSANDO; a próxima rodada consulta de novo
    }
    throw err;
  }
  if (c.status === 'PENDENTE') return atual;
  if (c.status === 'FALHOU' || c.status === 'CANCELADO') {
    return aplicarStatusTerminalRuim(atual.id, c.status, c.motivoFalha ?? 'PSP_FALHA');
  }
  // CONCLUIDO
  if (c.valor === undefined && provider.nome !== 'SIMULADO') {
    // P3 do Argus: DONE sem o valor não prova que saiu o valor pedido. Estado de alerta, nunca comprova às cegas.
    await marcar(atual.id, { status: 'INCERTO', motivoFalha: 'PSP_SEM_VALOR', travaAte: null });
    throw new LiquidacaoCedenteError('VALOR_DIVERGE', 'PSP_SEM_VALOR');
  }
  if (c.valor !== undefined && !new Prisma.Decimal(c.valor).eq(atual.valor)) {
    // O PSP concluiu um valor diferente do pedido: dinheiro saiu errado. Estado de alerta (INCERTO, com providerId:
    // nada retoma sozinho), não fica PROCESSANDO em silêncio.
    await marcar(atual.id, { status: 'INCERTO', motivoFalha: 'PSP_VALOR_DIVERGE', travaAte: null });
    throw new LiquidacaoCedenteError('VALOR_DIVERGE', 'PSP_VALOR_DIVERGE');
  }

  let bytes: Buffer;
  let sha256: string;
  if (atual.comprovante && atual.comprovanteSha256) {
    bytes = Buffer.from(atual.comprovante, 'utf8'); // retomada: os MESMOS bytes, nunca remonta
    sha256 = atual.comprovanteSha256;
  } else {
    const m = montarComprovante({
      provedor: provider.nome,
      transferenciaId: atual.providerId,
      e2eId: c.e2eId ?? null,
      valor: new Prisma.Decimal(atual.valor).toFixed(2),
      efetivadoEm: c.efetivadoEm ?? new Date().toISOString(),
      destino: atual.destinoMascarado,
      cessaoId: atual.cessaoId,
      referencia: atual.idempotencyKey,
    });
    bytes = m.bytes;
    sha256 = m.sha256;
    atual = await marcar(atual.id, { comprovante: bytes.toString('utf8'), comprovanteSha256: sha256, e2eId: c.e2eId ?? null });
  }

  let pathname: string;
  try {
    ({ pathname } = await guardarComprovantePsp({ cessaoId: atual.cessaoId, bytes }));
  } catch (err) {
    if (err instanceof ComprovanteBlobError) throw new LiquidacaoCedenteError('COMPROVANTE_FALHOU', err.motivo, { cause: err });
    throw err;
  }
  try {
    const ancora = await ancorarSha256({ sha256Hex: sha256, contexto: 'COMPROVANTE_PIX', desde: atual.criadoEm });
    return await marcar(atual.id, { status: 'COMPROVADA', comprovantePath: pathname, ancoraTxHash: ancora.txHash, travaAte: null });
  } catch (err) {
    if (err instanceof AncoraError) throw new LiquidacaoCedenteError('ANCORA_FALHOU', err.code, { cause: err });
    throw err;
  }
}

async function executar(row: TransferenciaPix, provider: PixProvider, agora: Date): Promise<ResultadoPagamento> {
  if (row.status === 'COMPROVADA' || row.status === 'FALHOU') return resultado(row);
  if (!(await lease(row.id, agora))) throw new LiquidacaoCedenteError('EM_ANDAMENTO');
  try {
    return resultado(await avancar(row, provider));
  } catch (err) {
    if (!(err instanceof LiquidacaoCedenteError)) console.error('[liquidacao-cedente]', extractSafeError(err));
    throw err;
  } finally {
    await liberar(row.id);
  }
}

type EntradaPagamento = { cessaoId: string; valor: string; chavePix: string; tipoChave: TipoChavePix };

/** Entrada validada (Zod strict) e chave Pix validada/normalizada POR TIPO, antes de qualquer claim ou envio. */
function validarEntrada(input: EntradaPagamento): EntradaPagamento {
  const p = entrada.safeParse(input);
  if (!p.success) throw new LiquidacaoCedenteError('ENTRADA_INVALIDA');
  const chave = validarChavePix(p.data.tipoChave, p.data.chavePix);
  if (!chave) throw new LiquidacaoCedenteError('ENTRADA_INVALIDA', 'CHAVE_PIX_INVALIDA');
  return { ...p.data, chavePix: chave };
}

/**
 * Envia ao PSP UMA vez e segue o fluxo. `row` já é o claim (ENVIANDO, com lease nosso). Resposta ambígua → INCERTO
 * (nunca reenvia); recusa do PSP → FALHOU (nada saiu).
 */
async function dispararEnvio(row: TransferenciaPix, i: EntradaPagamento, provider: PixProvider): Promise<ResultadoPagamento> {
  try {
    let enviada: { id: string; status: StatusPix };
    try {
      enviada = await provider.enviarPix({
        valor: i.valor,
        chavePix: i.chavePix,
        tipoChave: i.tipoChave,
        idempotencyKey: row.idempotencyKey,
      });
    } catch (err) {
      if (err instanceof PspError && err.code === 'PSP_RECUSOU') {
        row = await marcar(row.id, { status: 'FALHOU', motivoFalha: 'PSP_RECUSOU', travaAte: null });
        return resultado(row);
      }
      if (err instanceof PspError) {
        // Ambíguo (timeout/5xx/429/rede/resposta ilegível): pode ter saído. NUNCA reenvia.
        console.error('[liquidacao-cedente] envio incerto', err.code);
        row = await marcar(row.id, { status: 'INCERTO', motivoFalha: err.code, travaAte: null });
        return resultado(row);
      }
      throw err;
    }
    row = await marcar(row.id, { providerId: enviada.id, status: 'PROCESSANDO', motivoFalha: null });
    return resultado(await avancar(row, provider));
  } catch (err) {
    if (!(err instanceof LiquidacaoCedenteError)) console.error('[liquidacao-cedente]', extractSafeError(err));
    throw err;
  } finally {
    await liberar(row.id);
  }
}

/**
 * Paga o titular. Idempotente por cessão: a 2ª chamada não paga de novo (devolve o estado). A chave Pix vem na
 * chamada e não é persistida; é validada por tipo antes do claim (typo não queima a tentativa).
 */
export async function pagarTitular(
  input: EntradaPagamento,
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamento> {
  const i = validarEntrada(input);
  const provider = opts.provider ?? obterPixProvider();
  const agora = opts.agora ?? new Date();

  const existente = await db.transferenciaPix.findUnique({ where: { cessaoId: i.cessaoId } });
  if (existente) {
    if (!new Prisma.Decimal(i.valor).eq(existente.valor)) throw new LiquidacaoCedenteError('VALOR_DIVERGE');
    if (existente.provedor !== provider.nome) throw new LiquidacaoCedenteError('PROVEDOR_DIVERGE');
    return executar(existente, provider, agora);
  }

  // Claim ANTES de falar com o PSP.
  let row: TransferenciaPix;
  try {
    row = await db.transferenciaPix.create({
      data: {
        cessaoId: i.cessaoId,
        idempotencyKey: chaveDaCessao(i.cessaoId),
        provedor: provider.nome,
        valor: i.valor,
        destinoMascarado: mascararDestino(i.tipoChave, i.chavePix),
        travaAte: new Date(agora.getTime() + LEASE_PIX_MS),
      },
    });
  } catch (err) {
    if (!ehUnique(err)) throw err;
    throw new LiquidacaoCedenteError('EM_ANDAMENTO'); // outra execução criou o claim agora
  }
  return dispararEnvio(row, i, provider);
}

/**
 * Reabre um pagamento FALHOU (confirmado pelo PSP: recusa 4xx, FAILED ou CANCELLED — nada saiu) e envia de novo com
 * idempotencyKey NOVA (`pix-cedente:<cessao>:<n>`). Auditado: a tentativa anterior (chave, providerId, motivo, operador,
 * hora) é acrescentada a `historico`; a recuperação de incerteza passa a olhar TODAS as chaves. Qualquer outro estado
 * (INCERTO, PROCESSANDO, COMPROVADA) NÃO reabre: o dinheiro pode ter saído. Decisão do operador, nunca automática.
 */
export async function reabrirTransferencia(
  input: EntradaPagamento & { operador: string },
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamento> {
  if (typeof input.operador !== 'string' || !/^[A-Za-z0-9:_.-]{1,80}$/.test(input.operador)) {
    throw new LiquidacaoCedenteError('ENTRADA_INVALIDA', 'OPERADOR_INVALIDO');
  }
  const { operador, ...resto } = input;
  const i = validarEntrada(resto);
  const provider = opts.provider ?? obterPixProvider();
  const agora = opts.agora ?? new Date();

  const row = await db.transferenciaPix.findUnique({ where: { cessaoId: i.cessaoId } });
  if (!row) throw new LiquidacaoCedenteError('TRANSFERENCIA_NAO_ENCONTRADA');
  if (!new Prisma.Decimal(i.valor).eq(row.valor)) throw new LiquidacaoCedenteError('VALOR_DIVERGE');
  if (row.provedor !== provider.nome) throw new LiquidacaoCedenteError('PROVEDOR_DIVERGE');
  if (row.status !== 'FALHOU') throw new LiquidacaoCedenteError('NAO_REABRIVEL', row.status);

  const nova = row.tentativa + 1;
  const entrada: TentativaAnterior = {
    tentativa: row.tentativa,
    idempotencyKey: row.idempotencyKey,
    providerId: row.providerId,
    motivoFalha: row.motivoFalha,
    reabertaEm: agora.toISOString(),
    operador,
  };
  // Atômico: só reabre se continua FALHOU na MESMA tentativa (duas reaberturas simultâneas = uma só).
  const r = await db.transferenciaPix.updateMany({
    where: { id: row.id, status: 'FALHOU', tentativa: row.tentativa },
    data: {
      status: 'ENVIANDO',
      tentativa: nova,
      idempotencyKey: chaveDaCessao(row.cessaoId, nova),
      historico: [...anteriores(row), entrada] as unknown as Prisma.InputJsonValue,
      providerId: null,
      e2eId: null,
      motivoFalha: null,
      destinoMascarado: mascararDestino(i.tipoChave, i.chavePix),
      travaAte: new Date(agora.getTime() + LEASE_PIX_MS),
    },
  });
  if (r.count !== 1) throw new LiquidacaoCedenteError('EM_ANDAMENTO');
  const reaberta = await db.transferenciaPix.findUnique({ where: { cessaoId: row.cessaoId } });
  if (!reaberta) throw new LiquidacaoCedenteError('TRANSFERENCIA_NAO_ENCONTRADA');
  return dispararEnvio(reaberta, i, provider);
}

/** Retoma/consulta o pagamento de uma cessão (job ou operador). Nunca reenvia. */
export async function avancarTransferencia(
  cessaoId: string,
  opts: { provider?: PixProvider; agora?: Date } = {},
): Promise<ResultadoPagamento> {
  const row = await db.transferenciaPix.findUnique({ where: { cessaoId } });
  if (!row) throw new LiquidacaoCedenteError('TRANSFERENCIA_NAO_ENCONTRADA');
  return executar(row, opts.provider ?? obterPixProvider(), opts.agora ?? new Date());
}
