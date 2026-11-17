/**
 * Trava por ordem da consulta de status ao anchor (rota `GET /api/investidor/buy/onramp/status`): no máximo UMA consulta à
 * Etherfuse por ordem a cada N segundos, somando TODAS as instâncias (o cache de 5 s da rota é por instância).
 *
 * A reserva é UMA instrução SQL atômica com o relógio do BANCO: ganha quem muda `statusConsultadoEm` (1 linha afetada); quem perde
 * (outra instância reservou há menos de N s) devolve o estado guardado, sem consultar o anchor. Não é um lock mantido durante a
 * chamada de rede (seria uma transação aberta e uma conexão presa): a coluna funciona como JANELA.
 *
 * Por que SQL CRU: o `@updatedAt` do Prisma é preenchido pelo CLIENTE; um `update` comum para marcar a consulta moveria
 * `atualizadoEm`, que o A-09 usa como "desde quando a ordem espera" (a ordem nunca ficaria atrasada). O SQL cru não o toca.
 * A coluna é `timestamp` sem fuso (UTC); por isso ambos os lados usam `now() AT TIME ZONE 'UTC'`, sem depender do fuso da sessão.
 * Terminal nunca é reservado. A reserva NÃO é desfeita se o anchor falhar (evita martelar um anchor fora do ar; a janela resolve).
 */
import { Prisma } from '@prisma/client';
import { db } from '../db';

/** Status finais da ordem de onramp: FONTE ÚNICA (a rota de status e o SQL da reserva leem esta mesma lista, nunca uma cópia escrita à mão). */
export const STATUS_TERMINAIS_ONRAMP = ['completed', 'failed', 'expired', 'cancelled', 'refunded'] as const;

/** Mínimo entre duas consultas à Etherfuse para a mesma ordem (igual ao TTL do cache de 5 s da rota). */
export const ONRAMP_CONSULTA_MIN_INTERVALO_S = 5;

/** `true` = esta chamada ganhou a reserva e PODE consultar o anchor; `false` = outra consultou há menos de N s (ou ordem terminal/inexistente). */
export async function reservarConsultaDeStatus(orderId: string): Promise<boolean> {
  const afetadas = await db.$executeRaw`
    UPDATE "OnRampOrder"
       SET "statusConsultadoEm" = (now() AT TIME ZONE 'UTC')
     WHERE id = ${orderId}
       AND status NOT IN (${Prisma.join([...STATUS_TERMINAIS_ONRAMP])})
       AND ("statusConsultadoEm" IS NULL
            OR "statusConsultadoEm" < (now() AT TIME ZONE 'UTC') - (${ONRAMP_CONSULTA_MIN_INTERVALO_S} * interval '1 second'))`;
  return afetadas === 1;
}
