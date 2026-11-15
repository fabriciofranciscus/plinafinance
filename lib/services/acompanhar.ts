/**
 * Acompanhamento da solicitação do cedente (item 19, Argus): o `leadId` na URL deixou de ser "senha" para ler dado pessoal.
 *   - `acompanharPublico`: o que a página pública (sem sessão) pode mostrar a quem só tem o link: SÓ a etapa e o status.
 *     Nunca nome, valores, hashes nem ids de oferta/cessão.
 *   - `acompanharDoDono`: o detalhe completo (nome, oferta, txs), só para a Pessoa dona do lead. Não-dono, id inexistente e
 *     lead sem dono dão o MESMO resultado (`null`): a rota responde 404 e não confirma que o id existe.
 */
import { db } from '../db';
import { nomeDoCedente } from '../vender/nome';
import { txExplorerUrl } from '../stellar/config';
import { contextoDoStatus, etapaDoStatus, isEncerrado } from '../vender/etapas';
import type { LeadVendedorStatus } from '@prisma/client';

export interface AcompanharPublico {
  status: LeadVendedorStatus;
  etapaAtual: number;
  encerrado: boolean;
  contextoDescricao: string;
}

export interface TxPublica {
  hashShort: string;
  url: string;
}

export interface AcompanharDetalhe extends AcompanharPublico {
  leadId: string;
  /** Só nome de verdade; e-mail ou "Nome não informado" viram null (regra `nomeDoCedente`). */
  cedenteNome: string | null;
  ofertaId: string | null;
  oferta: null | {
    valorCarta: string; // BRL, 2 casas
    desagioPct: string; // 1 casa, ex.: "18.5"
    valorLiquido: string; // BRL, 2 casas
    prazoRestanteMeses: number | null;
    validade: string; // ISO-8601
  };
  cessaoId: string | null;
  consentTx: TxPublica | null;
  cessaoTx: TxPublica | null;
  pixTx: TxPublica | null;
  temCota: boolean;
  aguardandoAssinatura: boolean;
}

function txLink(hash: string | null | undefined): TxPublica | null {
  if (!hash) return null;
  return { hashShort: hash.slice(0, 8), url: txExplorerUrl(hash) };
}

function resumoPublico(status: LeadVendedorStatus): AcompanharPublico {
  return {
    status,
    etapaAtual: etapaDoStatus(status),
    encerrado: isEncerrado(status),
    contextoDescricao: contextoDoStatus(status).descricao,
  };
}

/** Só etapa e status (sem dado pessoal). `null` se o lead não existe. */
export async function acompanharPublico(leadId: string): Promise<AcompanharPublico | null> {
  const lead = await db.leadVendedor.findUnique({ where: { id: leadId }, select: { status: true } });
  return lead ? resumoPublico(lead.status) : null;
}

/** Detalhe completo, só se o lead for da Pessoa informada. `null` para qualquer outro caso (não distingue). */
export async function acompanharDoDono(leadId: string, pessoaId: string | null): Promise<AcompanharDetalhe | null> {
  if (!pessoaId) return null;
  const lead = await db.leadVendedor.findFirst({
    where: { id: leadId, pessoaId },
    select: {
      id: true,
      nome: true,
      status: true,
      ofertas: {
        orderBy: { criadaEm: 'desc' },
        take: 1,
        select: {
          id: true,
          valorCarta: true,
          desagioAquisicao: true,
          valorLiquidoVendedor: true,
          prazoRestanteMeses: true,
          validade: true,
          cessao: {
            select: {
              id: true,
              status: true,
              onChainTxHash: true,
              pagamento: { select: { onChainTxHash: true } },
              cota: { select: { id: true } },
            },
          },
        },
      },
      // Prova on-chain do consentimento registrada na captura do lead (hash público do documento).
      eventos: {
        where: { acao: 'LEAD_VENDEDOR_CAPTURADO' },
        orderBy: { criadoEm: 'desc' },
        take: 1,
        select: { stellarTxHash: true },
      },
    },
  });
  if (!lead) return null;

  const oferta = lead.ofertas[0] ?? null;
  const cessao = oferta?.cessao ?? null;
  return {
    ...resumoPublico(lead.status),
    leadId: lead.id,
    cedenteNome: nomeDoCedente(lead.nome),
    ofertaId: oferta?.id ?? null,
    oferta: oferta
      ? {
          valorCarta: oferta.valorCarta.toFixed(2),
          desagioPct: (Number(oferta.desagioAquisicao) * 100).toFixed(1),
          valorLiquido: oferta.valorLiquidoVendedor.toFixed(2),
          prazoRestanteMeses: oferta.prazoRestanteMeses,
          validade: oferta.validade.toISOString(),
        }
      : null,
    cessaoId: cessao?.id ?? null,
    consentTx: txLink(lead.eventos[0]?.stellarTxHash),
    cessaoTx: txLink(cessao?.onChainTxHash),
    pixTx: txLink(cessao?.pagamento?.onChainTxHash),
    temCota: !!cessao?.cota,
    aguardandoAssinatura: cessao?.status === 'ENVIADA_DOCUSIGN',
  };
}
