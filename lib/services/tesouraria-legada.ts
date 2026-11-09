/**
 * TES-1 — registro da tesouraria legada como posição da Plina.
 *
 * Os tokens que já estão no distributor foram cunhados 1:1 contra cotas que
 * continuam no numerador do NAV. Pela ADR 2026-11-09 (parecer da Consuelo, C3)
 * eles são a **posição da Plina** e contam em N — não são "tesouraria ao par".
 *
 * Este módulo faz só a parte segura: lê o saldo REAL do distributor no Horizon
 * (por code) e grava um `EventoAudit` append-only. Não é `MovimentoFundo` (o ativo
 * A não muda), não move nada on-chain e **não altera o NAV**: a dedução da
 * tesouraria em `pool.ts` continua — retirá-la muda valor esperado de teste e
 * espera o ok da Thais (protocolo §7).
 *
 * Idempotente: se o último registro daquele code tem o mesmo saldo, não duplica;
 * saldo diferente vira novo evento (histórico).
 */

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { fetchSaldoTesourariaDasClasses, type SaldoTesouraria } from '../stellar/supply';

export interface RegistroTesourariaLegada {
  code: string;
  saldo: string;
  registrado: boolean;
}

async function registrarUm(s: SaldoTesouraria, operador: string): Promise<RegistroTesourariaLegada> {
  const saldo = s.saldo.toFixed(7);
  const ultimo = await db.eventoAudit.findFirst({
    where: {
      acao: 'TESOURARIA_LEGADA_REGISTRADA',
      payloadJson: { path: ['code'], equals: s.code },
    },
    orderBy: { criadoEm: 'desc' },
    select: { payloadJson: true },
  });
  const anterior = (ultimo?.payloadJson as { saldo?: string } | null)?.saldo;
  if (anterior !== undefined && new Prisma.Decimal(anterior).eq(s.saldo)) {
    return { code: s.code, saldo, registrado: false };
  }
  await db.eventoAudit.create({
    data: {
      acao: 'TESOURARIA_LEGADA_REGISTRADA',
      operador,
      payloadJson: {
        code: s.code,
        issuer: s.issuer,
        distributor: s.distributor,
        saldo,
        lidoEm: s.lidoEm.toISOString(),
        classificacao: 'POSICAO_DA_PLINA',
        // Reclassificação em N (contada no denominador). Sem movimento on-chain,
        // sem MovimentoFundo; a dedução ao par em pool.ts segue até o ok da Thais.
        movimentoOnChain: false,
      } as Prisma.InputJsonValue,
    },
  });
  return { code: s.code, saldo, registrado: true };
}

/** Lê o saldo real do distributor (PLINARF e PLINARFB) e registra a posição legada. */
export async function registrarTesourariaLegada(input: {
  operador: string;
}): Promise<{ posicoes: RegistroTesourariaLegada[] }> {
  // Falha do Horizon propaga (fail-closed): não se registra saldo que não foi lido.
  const { senior, subordinada } = await fetchSaldoTesourariaDasClasses();
  const posicoes = [
    await registrarUm(senior, input.operador),
    await registrarUm(subordinada, input.operador),
  ];
  return { posicoes };
}
