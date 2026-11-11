/**
 * DS3 — conclusão da cessão assinada: baixa o PDF, GUARDA OS BYTES, SHA-256 dos
 * bytes guardados → memo ancorado → ASSINADA.
 *
 * Disparo: webhook do DocuSign Connect OU polling de fallback (/admin). Ambos
 * chamam `processarEnvelopeDocusign`. Nunca confia no corpo do webhook: o status
 * é relido na API do DocuSign.
 *
 * Passos retomáveis e idempotentes (crash em qualquer ponto → próxima chamada
 * continua sem refazer o que já vale):
 *   1. claim no banco (`docusignConclusaoIniciadaEm`);
 *   2. bytes: se já guardados, usa os guardados; senão baixa e guarda UMA vez
 *      (o 2º download do DocuSign não é idêntico — nunca se re-baixa para hashear);
 *   3. `hashDocumento` = SHA-256 dos bytes guardados (gravado só se ainda nulo);
 *   4. âncora: procura memo com esse hash antes de ancorar de novo;
 *   5. ASSINADA + EventoAudit (payloadHash = hash, stellarTxHash) + e-mail.
 * Dedupe: por estado da cessão (já ASSINADA → duplicada) + claim; sem tabela de eventos.
 */

import { createHash } from 'node:crypto';
import { CessaoStatus, LeadVendedorStatus, Prisma } from '@prisma/client';
import { db } from '../db';
import { baixarDocumentoAssinado, obterStatusEnvelope } from '../integrations/docusign';
import {
  guardarCessaoAssinada,
  lerCessaoAssinada,
} from '../comprovante/cessao-store';
import { ancorar, buscarAncora } from './ancora-sha256';
import { notifyCedente } from '../email/notify-cedente';

export const CONCLUSAO_JANELA_MS = 120_000;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export type ResultadoEnvelope =
  | 'ASSINADA'
  | 'JA_ASSINADA'
  | 'AGUARDANDO'
  | 'CANCELADA'
  | 'EM_ANDAMENTO'
  | 'DESCONHECIDA';

export const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export async function processarEnvelopeDocusign(
  envelopeId: string,
  operador = 'docusign',
): Promise<{ resultado: ResultadoEnvelope; cessaoId?: string; hashDocumento?: string; txHash?: string }> {
  const cessao = await db.cessao.findFirst({
    where: { docusignEnvelopeId: envelopeId },
    include: { oferta: { include: { leadVendedor: { select: { email: true, nome: true } } } } },
  });
  if (!cessao) return { resultado: 'DESCONHECIDA' };
  if (cessao.status === CessaoStatus.ASSINADA) {
    return { resultado: 'JA_ASSINADA', cessaoId: cessao.id, hashDocumento: cessao.hashDocumento ?? undefined, txHash: cessao.onChainTxHash ?? undefined };
  }
  if (cessao.status !== CessaoStatus.ENVIADA_DOCUSIGN) return { resultado: 'CANCELADA', cessaoId: cessao.id };

  // Verdade = a API do DocuSign, não o corpo do webhook.
  const status = await obterStatusEnvelope(envelopeId);
  if (status === 'recusado' || status === 'anulado') {
    await db.$transaction(async (tx) => {
      const r = await tx.cessao.updateMany({
        where: { id: cessao.id, status: CessaoStatus.ENVIADA_DOCUSIGN },
        data: { status: CessaoStatus.CANCELADA },
      });
      if (r.count !== 1) return;
      await tx.eventoAudit.create({
        data: {
          acao: 'CESSAO_RECUSADA_DOCUSIGN',
          operador,
          leadVendedorId: cessao.oferta.leadVendedorId,
          ofertaId: cessao.ofertaId,
          cessaoId: cessao.id,
          payloadJson: { envelopeId, statusDocusign: status } as Prisma.InputJsonValue,
        },
      });
    });
    return { resultado: 'CANCELADA', cessaoId: cessao.id };
  }
  if (status !== 'concluido') return { resultado: 'AGUARDANDO', cessaoId: cessao.id };

  // 1) claim
  const agora = Date.now();
  const claim = await db.cessao.updateMany({
    where: {
      id: cessao.id,
      status: CessaoStatus.ENVIADA_DOCUSIGN,
      OR: [{ docusignConclusaoIniciadaEm: null }, { docusignConclusaoIniciadaEm: { lt: new Date(agora - CONCLUSAO_JANELA_MS) } }],
    },
    data: { docusignConclusaoIniciadaEm: new Date(agora) },
  });
  if (claim.count !== 1) return { resultado: 'EM_ANDAMENTO', cessaoId: cessao.id };

  try {
    // 2–3) bytes guardados + hash
    let hash = cessao.hashDocumento;
    if (!hash) {
      let bytes = await lerCessaoAssinada(cessao.id);
      if (!bytes) {
        bytes = await baixarDocumentoAssinado(envelopeId);
        await guardarCessaoAssinada(cessao.id, bytes);
      }
      hash = sha256Hex(bytes);
      await db.cessao.updateMany({ where: { id: cessao.id, hashDocumento: null }, data: { hashDocumento: hash } });
    }

    // 4) âncora (memo = SHA-256 dos bytes guardados); procura antes de ancorar
    const txHash = (await buscarAncora(hash))?.txHash ?? (await ancorar(hash)).txHash;

    // 5) ASSINADA
    await db.$transaction(async (tx) => {
      const r = await tx.cessao.updateMany({
        where: { id: cessao.id, status: CessaoStatus.ENVIADA_DOCUSIGN },
        data: { status: CessaoStatus.ASSINADA, assinadaEm: new Date(), onChainTxHash: txHash, hashDocumento: hash },
      });
      if (r.count !== 1) throw new Error('Cessão mudou de estado durante a conclusão');
      await tx.leadVendedor.update({
        where: { id: cessao.oferta.leadVendedorId },
        data: { status: LeadVendedorStatus.CESSAO_ASSINADA },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'CESSAO_ASSINADA',
          operador,
          leadVendedorId: cessao.oferta.leadVendedorId,
          ofertaId: cessao.ofertaId,
          cessaoId: cessao.id,
          payloadJson: { envelopeId, hashDocumento: hash } as Prisma.InputJsonValue,
          payloadHash: hash,
          stellarTxHash: txHash,
        },
      });
    });

    await notifyCedente(cessao.oferta.leadVendedor?.email, 'cessao', {
      leadId: cessao.oferta.leadVendedorId,
      nome: cessao.oferta.leadVendedor?.nome,
      valorLiquido: BRL.format(Number(cessao.oferta.valorLiquidoVendedor)),
      onChainTxHash: txHash,
    });
    return { resultado: 'ASSINADA', cessaoId: cessao.id, hashDocumento: hash, txHash };
  } catch (err) {
    // Libera o claim: os passos já feitos (bytes, hash) valem na próxima tentativa.
    await db.cessao
      .updateMany({ where: { id: cessao.id, status: CessaoStatus.ENVIADA_DOCUSIGN }, data: { docusignConclusaoIniciadaEm: null } })
      .catch(() => undefined);
    throw err;
  }
}

/** Polling de fallback (/admin): reconcilia as cessões ainda ENVIADA_DOCUSIGN. */
export async function sincronizarCessoesDocusign(opts: { cessaoId?: string; limite?: number; operador?: string } = {}) {
  const pendentes = await db.cessao.findMany({
    where: { status: CessaoStatus.ENVIADA_DOCUSIGN, docusignEnvelopeId: { not: null }, ...(opts.cessaoId ? { id: opts.cessaoId } : {}) },
    select: { id: true, docusignEnvelopeId: true },
    take: Math.min(opts.limite ?? 20, 50),
    orderBy: { criadaEm: 'asc' },
  });
  const resultados: Array<{ cessaoId: string; resultado: ResultadoEnvelope | 'ERRO' }> = [];
  for (const c of pendentes) {
    try {
      const r = await processarEnvelopeDocusign(c.docusignEnvelopeId!, opts.operador ?? 'admin-sincronizacao');
      resultados.push({ cessaoId: c.id, resultado: r.resultado });
    } catch {
      // causa não vai ao retorno (pode citar config); o admin reexecuta
      resultados.push({ cessaoId: c.id, resultado: 'ERRO' });
    }
  }
  return { processadas: resultados.length, resultados };
}
