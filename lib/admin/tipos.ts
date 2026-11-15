/**
 * Dados de uma solicitação de venda no /admin (lead + oferta mais recente + cessão). Montados no servidor em
 * app/admin/page.tsx; o cliente só lê. Datas chegam como Date ou ISO; valores monetários como string.
 */

type Dec = string | number | { toString(): string };
type Quando = string | Date | null;

export interface CessaoAdmin {
  id: string;
  status: string;
  onChainTxHash: string | null;
  pagamento: { id: string; status: string; onChainTxHash: string | null } | null;
  cota: { id: string } | null;
  /** Existe o laudo registrado (evento COTA_VALIDADA da cessão). */
  laudoRegistrado?: boolean;
  /** Hash do laudo (payloadHash do COTA_VALIDADA): é o `hashValidacao` da anuência. */
  laudoHash?: string | null;
  /** Anuência da administradora registrada (CONFIRMADA | DECLARADA_PENDENTE), se houver. */
  anuenciaStatus?: string | null;
  /** Titular confirmado no laudo: null = ainda não confirmado. */
  titularSituacao?: string | null;
  /** Situação da transferência Pix da cessão (StatusTransferenciaPix), se existir. */
  pixStatus?: string | null;
  // Datas das etapas (só quando o servidor as tem; nunca inventadas)
  criadaEm?: Quando;
  envioEm?: Quando;
  assinadaEm?: Quando;
  laudoEm?: Quando;
  anuenciaEm?: Quando;
  pagamentoEm?: Quando;
  cotaEm?: Quando;
}

export interface OfertaAdmin {
  id: string;
  versao: number;
  tipoBem: string;
  valorCarta: Dec;
  valorLiquidoVendedor: Dec;
  desagioAquisicao: Dec;
  administradora: string;
  status: string;
  validade: Quando | string | Date;
  criadaEm?: Quando;
  cessao: CessaoAdmin | null;
}

export interface LeadAdmin {
  id: string;
  nome: string;
  email: string;
  status: string;
  criadoEm: string | Date;
  ofertas: OfertaAdmin[];
}
