/**
 * Processamento de webhook do anchor (E2-2). A assinatura já foi validada na
 * rota; aqui: dedupe por `eventoId`, persistência append-only em
 * `WebhookEvento` e efeito de domínio (`kyc_updated` → Pessoa/Investidor).
 *
 * Idempotente: a mesma entrega reenviada não reaplica o efeito. Entrega que
 * falhou no processamento (sem `processadoEm`) é reprocessada no reenvio.
 * Sem PII em log/WebhookEvento; `userMessage` vai só para `Pessoa`.
 */

import { Prisma, KycStatus, StatusInvestidor } from '@prisma/client';
import { db } from '../db';
import type { AnchorWebhookEvent } from '../anchors/webhook';

export interface WebhookResultado {
  duplicado: boolean;
  processado: boolean;
}

function mapKycStatus(status: string | null, approved: boolean | null): KycStatus | null {
  if (approved === true || status === 'approved') return KycStatus.APROVADO;
  switch (status) {
    case 'denied':
    case 'rejected':
      return KycStatus.REJEITADO;
    case 'submitted':
    case 'in_progress':
    case 'inProgress':
    case 'pending':
      return KycStatus.PENDENTE;
    case 'not_started':
    case 'notStarted':
      return KycStatus.NAO_INICIADO;
    default:
      return null;
  }
}

async function aplicarKycAtualizado(evt: AnchorWebhookEvent): Promise<string | null> {
  if (!evt.recursoId) return 'sem_recurso';
  const pessoa = await db.pessoa.findFirst({
    where: { etherfuseCustomerId: evt.recursoId },
    select: { id: true, privyId: true, kycStatus: true },
  });
  if (!pessoa) return 'pessoa_nao_encontrada';

  const novo = mapKycStatus(evt.status, evt.payload.approved as boolean | null);
  if (!novo) return 'status_desconhecido';
  // Fora de ordem: um `in_progress` atrasado não rebaixa quem já foi aprovado.
  // Negativa (denied) sempre vence — fail-closed.
  if (
    pessoa.kycStatus === KycStatus.APROVADO &&
    (novo === KycStatus.PENDENTE || novo === KycStatus.NAO_INICIADO)
  ) {
    return null;
  }

  const needsWork = evt.payload.needsWork === true;
  const aprovado = novo === KycStatus.APROVADO;

  await db.$transaction(async (tx) => {
    await tx.pessoa.update({
      where: { id: pessoa.id },
      data: {
        kycStatus: novo,
        kycAprovado: aprovado,
        kycNeedsWork: needsWork,
        // O aviso é point-in-time: persistir na chegada; limpar ao aprovar.
        ...(aprovado
          ? { kycUserMessage: null }
          : evt.userMessage
            ? { kycUserMessage: evt.userMessage }
            : {}),
      },
    });
    if (aprovado) {
      // Só promove quem aguarda KYC; nunca desfaz REVOGADO.
      await tx.investidor.updateMany({
        where: { pessoaId: pessoa.id, status: StatusInvestidor.PENDENTE_KYC },
        data: { kycAprovado: true, status: StatusInvestidor.AUTORIZADO },
      });
    } else if (novo === KycStatus.REJEITADO) {
      await tx.investidor.updateMany({
        where: { pessoaId: pessoa.id },
        data: { kycAprovado: false },
      });
    }
    await tx.eventoAudit.create({
      data: {
        acao: 'KYC_ATUALIZADO_WEBHOOK',
        operador: 'webhook-anchor',
        privyId: pessoa.privyId,
        payloadJson: { status: novo, needsWork } as Prisma.InputJsonValue,
      },
    });
  });
  return null;
}

export async function processarWebhookAnchor(evt: AnchorWebhookEvent): Promise<WebhookResultado> {
  let registroId: string;
  try {
    const criado = await db.webhookEvento.create({
      data: {
        fornecedor: evt.fornecedor,
        eventoId: evt.eventoId,
        tipo: evt.tipo,
        recursoId: evt.recursoId,
        payloadJson: evt.payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    registroId = criado.id;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      throw err;
    }
    const existente = await db.webhookEvento.findUnique({
      where: {
        fornecedor_eventoId: { fornecedor: evt.fornecedor, eventoId: evt.eventoId },
      },
      select: { id: true, processadoEm: true },
    });
    if (!existente || existente.processadoEm) {
      return { duplicado: true, processado: false };
    }
    registroId = existente.id; // entrega anterior não terminou: reprocessa
  }

  try {
    const erro = evt.tipo === 'kyc_updated' ? await aplicarKycAtualizado(evt) : null;
    await db.webhookEvento.update({
      where: { id: registroId },
      data: { processadoEm: new Date(), erro },
    });
    return { duplicado: false, processado: true };
  } catch (err) {
    // Mensagem genérica: o erro original pode conter dados do payload.
    await db.webhookEvento
      .update({ where: { id: registroId }, data: { erro: 'processamento_falhou' } })
      .catch(() => undefined);
    throw err;
  }
}
