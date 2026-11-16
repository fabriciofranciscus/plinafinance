/**
 * GET /api/investidor/buy/onramp/status?orderId=...
 *
 * Lê estado da OnRampOrder. Se não terminal e não-mock, faz pull no
 * Etherfuse e atualiza o DB (status + stellarTxHash quando completed).
 * Cliente faz polling enquanto status != completed.
 *
 * Returns: { orderId, status, stellarTxHash, mock, paymentInstructions, desde, atrasada, limiteSegundos } (os 3 últimos: U2 A-09,
 * aditivos; `atrasada` = processing sem claimable balance há mais de 180 s, ver lib/services/ordem-pendente.ts)
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { EtherfuseClient } from '@/lib/anchors/etherfuse';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { onrampStatusLimiter } from '@/lib/rate-limit/config';
import { infoConfirmacao } from '@/lib/services/ordem-pendente';

export const dynamic = 'force-dynamic';

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded']);

/**
 * Cache curto (best-effort, em memória da instância) do status remoto por ordem: no máximo 1 consulta à Etherfuse a cada 5 s por
 * ordem e por instância. Só guarda estado NÃO terminal (o terminal sempre é lido de novo e gravado no banco). Só é lido depois da
 * checagem de dono e do limite, então não vira oráculo de ordem alheia.
 */
const STATUS_CACHE_TTL_MS = 5_000;
const STATUS_CACHE_MAX = 500;
type RemotoDoCache = Awaited<ReturnType<EtherfuseClient['getOnRampTransaction']>>;
const statusCache = new Map<string, { em: number; remote: RemotoDoCache }>();

function lerCache(orderId: string): { remote: RemotoDoCache } | null {
  const e = statusCache.get(orderId);
  if (!e) return null;
  if (Date.now() - e.em >= STATUS_CACHE_TTL_MS) {
    statusCache.delete(orderId);
    return null;
  }
  return { remote: e.remote };
}

function guardarCache(orderId: string, remote: RemotoDoCache): void {
  if (remote && TERMINAL.has(remote.status)) return;
  if (statusCache.size >= STATUS_CACHE_MAX) {
    const agora = Date.now();
    for (const [k, v] of statusCache) if (agora - v.em >= STATUS_CACHE_TTL_MS) statusCache.delete(k);
    if (statusCache.size >= STATUS_CACHE_MAX) statusCache.clear();
  }
  statusCache.set(orderId, { em: Date.now(), remote });
}

export const GET = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  const url = new URL(req.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) {
    throw new ApiError('VALIDATION_FAILED', 400, 'orderId obrigatório');
  }

  const order = await db.onRampOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError('NOT_FOUND', 404, 'order não encontrada');
  }
  if (order.investidorId !== user.investidorId) {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'order não pertence ao investidor autenticado',
    );
  }

  const instructions = order.paymentInstructionsJson as
    | (Record<string, unknown> & { __mock?: boolean })
    | null;
  const mock = instructions?.__mock === true;

  // Mock orders nunca consultam Etherfuse — flips só via /sandbox-pay.
  if (mock || TERMINAL.has(order.status)) {
    return ok(
      {
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        stellarClaimableBalanceId: order.stellarClaimableBalanceId,
        claimTxHash: order.claimTxHash,
        mock,
        paymentInstructions: instructions,
        ...infoConfirmacao(order),
      },
      { requestId },
    );
  }

  // Limite por investidor (depois do dono e do terminal/mock). Acima do limite, ou com o limiter fora do ar, degrada para leitura:
  // devolve o estado guardado no banco, sem consultar a Etherfuse e sem 429 (falha fechada para o anchor).
  let dentroDoLimite = false;
  try {
    dentroDoLimite = (await onrampStatusLimiter.consume(user.investidorId)) === true;
  } catch {
    dentroDoLimite = false;
  }
  if (!dentroDoLimite) {
    return ok(
      {
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        stellarClaimableBalanceId: order.stellarClaimableBalanceId,
        claimTxHash: order.claimTxHash,
        mock: false,
        paymentInstructions: instructions,
        // Mesmo formato da resposta normal: o aviso de atraso (U2 A-09) vem do banco, não da Etherfuse, e é justamente
        // quando o investidor mais espera (muitas consultas) que ele não pode sumir.
        ...infoConfirmacao(order),
      },
      { requestId },
    );
  }

  // Real: pull no Etherfuse (com cache de 5 s) + atualiza DB se mudou.
  const apiKey = process.env.ETHERFUSE_API_KEY;
  if (!apiKey) {
    // env ausente: erro interno, vira INTERNAL genérico (não surfacia).
    throw new Error('ETHERFUSE_API_KEY ausente');
  }
  const anchor = new EtherfuseClient({
    apiKey,
    baseUrl:
      process.env.ETHERFUSE_BASE_URL ?? 'https://api.sand.etherfuse.com',
  });

  const emCache = lerCache(orderId);
  let remote: RemotoDoCache;
  if (emCache) {
    remote = emCache.remote;
  } else {
    remote = await anchor.getOnRampTransaction(orderId);
    guardarCache(orderId, remote);
  }
  if (!remote) {
    // Etherfuse ainda indexando (PLINA-MOD-004) — devolve o que temos.
    return ok(
      {
        orderId: order.id,
        status: order.status,
        stellarTxHash: order.stellarTxHash,
        mock,
        paymentInstructions: instructions,
        indexing: true,
        ...infoConfirmacao(order),
      },
      { requestId },
    );
  }

  const newStatus = remote.status;
  const newTxHash = remote.stellarTxHash ?? null;
  const newCbId =
    remote.stellarClaimableBalanceId ?? order.stellarClaimableBalanceId;
  const changed =
    newStatus !== order.status ||
    newTxHash !== order.stellarTxHash ||
    newCbId !== order.stellarClaimableBalanceId;

  if (changed) {
    const settledNow = newStatus === 'completed' && !order.settledAt;
    await db.$transaction(async (tx) => {
      await tx.onRampOrder.update({
        where: { id: order.id },
        data: {
          status: newStatus,
          stellarTxHash: newTxHash,
          stellarClaimableBalanceId: newCbId,
          settledAt: settledNow ? new Date() : order.settledAt,
        },
      });
      if (settledNow) {
        await tx.eventoAudit.create({
          data: {
            acao: 'ONRAMP_LIQUIDADA',
            operador: 'etherfuse-anchor',
            investidorId: order.investidorId,
            privyId: user.privyId,
            stellarTxHash: newTxHash ?? undefined,
            payloadJson: {
              orderId: order.id,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  return ok(
    {
      orderId: order.id,
      status: newStatus,
      stellarTxHash: newTxHash,
      stellarClaimableBalanceId: newCbId,
      claimTxHash: order.claimTxHash,
      mock: false,
      paymentInstructions: instructions,
      // Se o status mudou agora, o `atualizadoEm` lido é o do status ANTERIOR: a espera começa neste instante.
      ...infoConfirmacao({
        status: newStatus,
        stellarClaimableBalanceId: newCbId,
        atualizadoEm: changed ? new Date() : order.atualizadoEm,
      }),
    },
    { requestId },
  );
});
