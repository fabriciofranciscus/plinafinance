/**
 * DS2 — envio da cessão para assinatura no DocuSign (remote signing).
 *
 * Garantias:
 *  - nunca dois envelopes por cessão: `transactionId` determinístico (cessão) +
 *    serialização NO BANCO (`docusignEnvioIniciadoEm`, claim por updateMany
 *    condicionado). O transactionId sozinho não resolve POSTs simultâneos;
 *  - resposta incerta (timeout/5xx/2xx sem id) → consulta por transactionId antes
 *    de qualquer reenvio; marca de envio "velha" também consulta primeiro;
 *  - SEM hash on-chain neste passo: a âncora é o SHA-256 do PDF ASSINADO guardado
 *    (DS3). Aqui só `ENVIADA_DOCUSIGN` + EventoAudit sem memo.
 * PII (nome/e-mail do cedente) só vai ao DocuSign; nunca a log, audit ou chain.
 */

import { Prisma, CessaoStatus } from '@prisma/client';
import { db } from '../db';
import {
  DocusignError,
  buscarEnvelopePorTransactionId,
  criarEnvelope,
  transactionIdDeterministico,
} from '../integrations/docusign';
import { buildCessaoPdf } from '../comprovante/cessao-pdf';
import { STELLAR_NETWORK } from '../stellar/config';
import { hashDoLaudo } from './titular-laudo';

/** Janela em que um envio em curso não pode ser assumido por outro (> timeouts do cliente). */
export const DOCUSIGN_ENVIO_JANELA_MS = 120_000;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mainnet: o instrumento afirma a cota quitada "conforme o laudo"; sem COTA_VALIDADA registrado o envio é recusado (F-DS2-1). */
export class EnvioDocusignLaudoAusenteError extends Error {
  readonly code = 'LAUDO_AUSENTE' as const;
  constructor() {
    super('Não há laudo de validação registrado para esta cessão: o envio para assinatura na mainnet exige o laudo.');
    this.name = 'EnvioDocusignLaudoAusenteError';
  }
}

export class EnvioDocusignEmAndamentoError extends Error {
  readonly code = 'ENVIO_DOCUSIGN_EM_ANDAMENTO' as const;
  constructor() {
    super('O envio da cessão ao DocuSign já está em andamento; tente de novo em instantes.');
    this.name = 'EnvioDocusignEmAndamentoError';
  }
}

export interface ResultadoEnvioCessao {
  cessaoId: string;
  status: CessaoStatus;
  envelopeId: string;
  /** `true` quando o envelope já existia (reenvio/idempotência) e nada foi criado agora. */
  jaEnviada: boolean;
}

export function transactionIdDaCessao(cessaoId: string): string {
  return transactionIdDeterministico(`cessao:${cessaoId}`);
}

export async function enviarCessaoParaAssinatura(input: {
  cessaoId: string;
  operador: string;
  agora?: number;
}): Promise<ResultadoEnvioCessao> {
  const agora = input.agora ?? Date.now();
  const cessao = await db.cessao.findUnique({
    where: { id: input.cessaoId },
    include: { oferta: { include: { leadVendedor: { select: { nome: true, email: true } } } } },
  });
  if (!cessao) throw new Error('Cessão não encontrada');
  if (cessao.status !== CessaoStatus.PENDENTE) {
    if (cessao.docusignEnvelopeId && cessao.status !== CessaoStatus.CANCELADA && cessao.status !== CessaoStatus.EXPIRADA) {
      return { cessaoId: cessao.id, status: cessao.status, envelopeId: cessao.docusignEnvelopeId, jaEnviada: true };
    }
    throw new Error(`Cessão em estado ${cessao.status} não pode ser enviada`);
  }
  const lead = cessao.oferta.leadVendedor;
  if (!lead?.email || !lead.nome) throw new Error('Cedente sem nome ou e-mail para assinatura');

  // Laudo (último COTA_VALIDADA da cessão): o PDF o cita. Na mainnet o envio sem laudo é recusado ANTES do claim, para não
  // publicar "quitada … conforme o laudo (ainda não registrado)"; em testnet segue e o PDF diz que não foi registrado.
  const hashLaudo = await hashDoLaudo(db, cessao.id);
  if (STELLAR_NETWORK === 'PUBLIC' && !hashLaudo) throw new EnvioDocusignLaudoAusenteError();

  // Claim no banco: só um chamador por vez chama o DocuSign.
  const limite = new Date(agora - DOCUSIGN_ENVIO_JANELA_MS);
  const marcaAnterior = cessao.docusignEnvioIniciadoEm;
  const claim = await db.cessao.updateMany({
    where: {
      id: cessao.id,
      status: CessaoStatus.PENDENTE,
      docusignEnvelopeId: null,
      OR: [{ docusignEnvioIniciadoEm: null }, { docusignEnvioIniciadoEm: { lt: limite } }],
    },
    data: { docusignEnvioIniciadoEm: new Date(agora) },
  });
  if (claim.count !== 1) {
    const atual = await db.cessao.findUnique({
      where: { id: cessao.id },
      select: { status: true, docusignEnvelopeId: true },
    });
    if (atual?.docusignEnvelopeId) {
      return { cessaoId: cessao.id, status: atual.status, envelopeId: atual.docusignEnvelopeId, jaEnviada: true };
    }
    throw new EnvioDocusignEmAndamentoError();
  }

  const transactionId = transactionIdDaCessao(cessao.id);
  const liberar = (definitivo: boolean) =>
    // incerto → marca "velha" (próximo chamador assume já, consultando antes); definitivo → limpa
    db.cessao
      .updateMany({
        where: { id: cessao.id, status: CessaoStatus.PENDENTE, docusignEnvelopeId: null },
        data: { docusignEnvioIniciadoEm: definitivo ? null : new Date(agora - DOCUSIGN_ENVIO_JANELA_MS - 1) },
      })
      .catch(() => undefined);

  let envelopeId: string | null = null;
  try {
    // Envio anterior que morreu ou ficou incerto: o envelope pode já existir.
    if (marcaAnterior) envelopeId = await buscarEnvelopePorTransactionId(transactionId);

    if (!envelopeId) {
      const o = cessao.oferta;
      const pdf = await buildCessaoPdf({
        cessaoId: cessao.id,
        cedenteNome: lead.nome,
        administradora: o.administradora,
        tipoBem: o.tipoBem,
        valorCarta: BRL.format(Number(o.valorCarta)),
        valorLiquido: BRL.format(Number(o.valorLiquidoVendedor)),
        desagioPct: `${(Number(o.desagioAquisicao) * 100).toFixed(2)}%`,
        demonstracao: STELLAR_NETWORK !== 'PUBLIC',
        hashLaudo,
      });
      try {
        envelopeId = (
          await criarEnvelope({
            documentoPdf: pdf,
            nomeDocumento: 'Cessão de cota de consórcio.pdf',
            signatario: { nome: lead.nome, email: lead.email },
            emailSubject: 'Plina — assine a cessão da sua cota de consórcio',
            transactionId,
          })
        ).envelopeId;
      } catch (err) {
        if (err instanceof DocusignError && err.codigo === 'RESULTADO_INCERTO') {
          envelopeId = await buscarEnvelopePorTransactionId(transactionId);
          if (!envelopeId) throw err;
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    const incerto = err instanceof DocusignError && (err.codigo === 'RESULTADO_INCERTO' || err.codigo === 'INDISPONIVEL');
    await liberar(!incerto);
    throw err;
  }

  await db.$transaction(async (tx) => {
    const r = await tx.cessao.updateMany({
      where: { id: cessao.id, status: CessaoStatus.PENDENTE, docusignEnvelopeId: null },
      data: { status: CessaoStatus.ENVIADA_DOCUSIGN, docusignEnvelopeId: envelopeId },
    });
    if (r.count !== 1) throw new Error('Cessão mudou de estado durante o envio');
    // Sem memo, sem payloadHash, sem tx: a âncora é o PDF assinado (DS3).
    await tx.eventoAudit.create({
      data: {
        acao: 'CESSAO_ENVIADA_DOCUSIGN',
        operador: input.operador,
        leadVendedorId: cessao.oferta.leadVendedorId,
        ofertaId: cessao.ofertaId,
        cessaoId: cessao.id,
        payloadJson: { envelopeId, transactionId } as Prisma.InputJsonValue,
      },
    });
  });

  return { cessaoId: cessao.id, status: CessaoStatus.ENVIADA_DOCUSIGN, envelopeId: envelopeId!, jaEnviada: false };
}
