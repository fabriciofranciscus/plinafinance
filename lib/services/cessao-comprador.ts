/**
 * Cessão digital do lado COMPRADOR (passo 4 do wizard /comprar).
 *
 * Espelha `registrarCessao` (originacao.ts, lado vendedor), mas ancorada na
 * `Reserva` — o comprador não tem `Oferta`. Convenções reusadas:
 *   - assinatura DocuSign/e-CPF no STUB MVP (`docusignEnvelopeId = "mvp-stub:…"`);
 *   - `hashDocumento` = SHA-256 de um placeholder determinístico (PDF real é
 *     Fase 1) via `sha256OfPayload`;
 *   - prova on-chain REAL via `registerOnChainHash` (Memo.hash na Stellar).
 *
 * Gate: a Reserva precisa estar ATIVA e a Pessoa com KYC aprovado (validado na
 * rota). Idempotente por `reservaId` (@unique em CessaoComprador): re-chamar
 * devolve a cessão existente sem nova tx.
 */

import { CessaoStatus, Prisma, ReservaStatus } from '@prisma/client';
import { db } from '../db';
import {
  buildAuditPayload,
  registerOnChainHash,
  sha256OfPayload,
} from '../stellar/audit';

export interface RegistrarCessaoCompradorInput {
  reservaId: string;
  pessoaId: string;
  /** PDF base64 ou URL — placeholder no MVP testnet. */
  documentoBase64?: string;
}

export interface RegistrarCessaoCompradorResult {
  cessaoCompradorId: string;
  hashDocumento: string;
  payloadHash: string;
  txHash: string;
  reused: boolean;
}

export async function registrarCessaoComprador(
  input: RegistrarCessaoCompradorInput,
): Promise<RegistrarCessaoCompradorResult> {
  const reserva = await db.reserva.findUnique({
    where: { id: input.reservaId },
    include: { cessaoComprador: true },
  });
  if (!reserva) throw new Error('Reserva não encontrada');

  // Idempotente: cessão já assinada pra esta reserva → reusa (sem nova tx).
  if (reserva.cessaoComprador) {
    const c = reserva.cessaoComprador;
    return {
      cessaoCompradorId: c.id,
      hashDocumento: c.hashDocumento ?? '',
      payloadHash: c.hashDocumento ?? '',
      txHash: c.onChainTxHash ?? '',
      reused: true,
    };
  }

  if (reserva.status !== ReservaStatus.ATIVA) {
    throw new Error(`Reserva em estado ${reserva.status} — não assinável`);
  }

  // Hash do documento (placeholder no MVP — PDF real na Fase 1).
  const documentoBytes =
    input.documentoBase64 ??
    `cessao-comprador-mvp:${reserva.id}:${input.pessoaId}:${reserva.cotaId}`;
  const hashDocumento = sha256OfPayload({ bytes: documentoBytes });

  // Prova on-chain real.
  const payload = buildAuditPayload('cessao_comprador', reserva.id, {
    reservaId: reserva.id,
    cotaId: reserva.cotaId,
    pessoaId: input.pessoaId,
    hashDocumento,
  });
  const onChain = await registerOnChainHash(payload);

  const cessao = await db.$transaction(async (tx) => {
    const created = await tx.cessaoComprador.create({
      data: {
        reservaId: reserva.id,
        pessoaId: input.pessoaId,
        docusignEnvelopeId: `mvp-stub:${reserva.id.slice(0, 12)}`,
        hashDocumento,
        onChainTxHash: onChain.txHash,
        assinadaEm: new Date(),
        status: CessaoStatus.ASSINADA,
      },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'CESSAO_COMPRADOR_ASSINADA',
        operador: 'self-service',
        cotaId: reserva.cotaId,
        leadCompradorId: reserva.leadCompradorId,
        cessaoCompradorId: created.id,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        payloadHash: onChain.payloadHash,
        stellarTxHash: onChain.txHash,
      },
    });
    return created;
  });

  return {
    cessaoCompradorId: cessao.id,
    hashDocumento,
    payloadHash: onChain.payloadHash,
    txHash: onChain.txHash,
    reused: false,
  };
}
