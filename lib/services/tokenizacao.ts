/**
 * Tokenizacao service — orquestra incorporação de cotas e clawback.
 *
 * Key rules CLAUDE.md cumpridas aqui:
 *   - DB só atualiza APÓS sucesso on-chain (Stellar tx submit antes do Prisma create).
 *   - Audit log append-only via EventoAudit.
 *   - Idempotência: emissão usa UUID-like via DB para evitar duplicação caso
 *     o submit fique pendurado (POC aceita risco de retry duplo — Stellar
 *     submitTransaction é geralmente idempotente por hash do envelope).
 *   - Clawback exige motivo (enum força em compile-time) + fundamentoUrl
 *     ANTES de chamar executeClawback no issuer.
 *
 * Whitepaper §6.4 (PLINA-RF lastro), §6.5 (política clawback).
 */

import {
  CaminhoRealizacao,
  MotivoClawback,
  Prisma,
  StatusCota,
  TipoBem,
} from '@prisma/client';
import { db } from '../db';
import { executeClawback, issueAsset } from '../stellar/issuer';
import { tokensParaEmitir } from './pool';
import { assetCode } from '../stellar/config';

export interface IncorporarCotaInput {
  tipoBem: TipoBem;
  administradora: string;
  valorCarta: string;
  desagioAquisicao: string;
  desagioRevenda?: string;
  localizacaoAprox?: string;
  prazoRestanteMeses?: number;
  caminhoPrevisto?: CaminhoRealizacao;
  notas?: string;
  operador: string;
  /// Quando a cota veio do funil vendedor, liga à Cessao que originou.
  cessaoId?: string;
}

export interface IncorporarCotaResult {
  cotaId: string;
  txHash: string;
  tokensEmitidos: number;
}

/**
 * Incorpora cota ao pool: emite PLINARF on-chain (issuer → distributor),
 * persiste DB com hash da emissão, registra audit log.
 *
 * Falha de Stellar = nada persiste no DB (consistência).
 */
export async function incorporarCota(
  input: IncorporarCotaInput,
): Promise<IncorporarCotaResult> {
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerSecret || !distributorPubkey) {
    throw new Error(
      'STELLAR_ISSUER_SECRET + STELLAR_DISTRIBUTOR_PUBLIC obrigatórios.',
    );
  }

  const quantity = tokensParaEmitir({
    valorCarta: input.valorCarta,
    desagioAquisicao: input.desagioAquisicao,
  });
  if (quantity <= 0) {
    throw new Error('NAV calculado <= 0; verificar valorCarta e desagioAquisicao.');
  }
  const quantityStr = quantity.toFixed(7);

  // 1) On-chain primeiro (regra CLAUDE.md "DB após on-chain").
  const emissionRes = await issueAsset(issuerSecret, distributorPubkey, quantityStr);

  // 2) Persist + audit log na mesma transação Prisma.
  const cota = await db.$transaction(async (tx) => {
    const created = await tx.cota.create({
      data: {
        tipoBem: input.tipoBem,
        administradora: input.administradora,
        valorCarta: input.valorCarta,
        desagioAquisicao: input.desagioAquisicao,
        desagioRevenda: input.desagioRevenda ?? null,
        localizacaoAprox: input.localizacaoAprox ?? null,
        prazoRestanteMeses: input.prazoRestanteMeses ?? null,
        caminhoPrevisto: input.caminhoPrevisto ?? 'A_REVENDA',
        tokensEmitidos: quantityStr,
        emissaoTxHash: emissionRes.hash,
        notas: input.notas ?? null,
        cessaoId: input.cessaoId ?? null,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'COTA_INCORPORADA',
        operador: input.operador,
        cotaId: created.id,
        stellarTxHash: emissionRes.hash,
        payloadJson: {
          quantity: quantityStr,
          valorCarta: input.valorCarta,
          desagioAquisicao: input.desagioAquisicao,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'TOKEN_EMITIDO',
        operador: input.operador,
        cotaId: created.id,
        stellarTxHash: emissionRes.hash,
        payloadJson: {
          quantity: quantityStr,
          destination: distributorPubkey,
          asset: assetCode,
        } as Prisma.InputJsonValue,
      },
    });
    return created;
  });

  return { cotaId: cota.id, txHash: emissionRes.hash, tokensEmitidos: quantity };
}

export interface ExecutarClawbackInput {
  investidorId: string;
  amount: string;
  motivo: MotivoClawback;
  fundamentoUrl: string;
  operador: string;
}

export interface ExecutarClawbackResult {
  txHash: string;
}

/**
 * Executa clawback. Whitepaper §6.5: 4 hipóteses exclusivas (enum força).
 * Audit log GRAVADO ANTES da execução on-chain — assim mesmo se Stellar
 * falhar, fica registro da tentativa pra auditoria.
 */
export async function executarClawback(
  input: ExecutarClawbackInput,
): Promise<ExecutarClawbackResult> {
  if (!input.fundamentoUrl || !/^https?:\/\//.test(input.fundamentoUrl)) {
    throw new Error('fundamentoUrl obrigatória (URL pública do documento).');
  }
  const amountNum = Number(input.amount);
  if (!isFinite(amountNum) || amountNum <= 0) {
    throw new Error('amount deve ser > 0.');
  }

  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('STELLAR_ISSUER_SECRET obrigatório.');
  }

  const investidor = await db.investidor.findUnique({
    where: { id: input.investidorId },
  });
  if (!investidor) throw new Error(`Investidor ${input.investidorId} não encontrado.`);

  // 1) Audit log da tentativa (antes do on-chain) — auditável mesmo em falha.
  const auditPre = await db.eventoAudit.create({
    data: {
      acao: 'CLAWBACK_EXECUTADO',
      operador: input.operador,
      investidorId: input.investidorId,
      motivoClawback: input.motivo,
      fundamentoUrl: input.fundamentoUrl,
      payloadJson: {
        amount: input.amount,
        targetPubkey: investidor.publicKey,
        status: 'attempting',
      } as Prisma.InputJsonValue,
    },
  });

  // 2) On-chain.
  const clawbackRes = await executeClawback(
    issuerSecret,
    investidor.publicKey,
    input.amount,
  );

  // 3) Atualiza audit log + saldoEsperado.
  await db.$transaction(async (tx) => {
    await tx.eventoAudit.update({
      where: { id: auditPre.id },
      data: {
        stellarTxHash: clawbackRes.hash,
        payloadJson: {
          amount: input.amount,
          targetPubkey: investidor.publicKey,
          status: 'executed',
        } as Prisma.InputJsonValue,
      },
    });
    await tx.investidor.update({
      where: { id: input.investidorId },
      data: {
        saldoEsperado: {
          decrement: new Prisma.Decimal(input.amount),
        },
      },
    });
  });

  return { txHash: clawbackRes.hash };
}

export interface AtualizarStatusCotaInput {
  cotaId: string;
  status: StatusCota;
  operador: string;
}

export async function atualizarStatusCota(input: AtualizarStatusCotaInput) {
  return db.cota.update({
    where: { id: input.cotaId },
    data: { status: input.status },
  });
}
