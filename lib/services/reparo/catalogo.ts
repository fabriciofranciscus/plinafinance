/**
 * Catálogo de reparos das sagas (T3, fatia 1; desenho em contratos/2026-11-16-bento-repararoperacao-desenho.md, v2 com as condições do Argus).
 *
 * SÓ DADOS E FUNÇÕES PURAS: sem banco, sem rede, sem executor. `papelMinimo`, `stepUp` e `duplaAprovacao` vivem AQUI e nunca vêm do
 * formulário (C2). Um par tipo × ação que não está no catálogo não existe (a futura action recusa). O executor de cada ação (que
 * reaproveita um serviço existente) é de uma fatia posterior; nada aqui executa nem escreve.
 */

export const TIPOS_OPERACAO = [
  'SWAP_ORFAO',
  'RESGATE_ORFAO',
  'OFFRAMP',
  'CESSAO',
  'PIX_SAIDA',
  'INCORPORACAO',
  'CLAWBACK',
  'SNAPSHOT_NAV',
] as const;
export type TipoOperacao = (typeof TIPOS_OPERACAO)[number];

export const ACOES_REPARO = ['RECONCILIAR', 'RECONSULTAR', 'REABRIR', 'SINCRONIZAR', 'RETOMAR', 'CANCELAR_ORDEM', 'CONSULTAR_REDE'] as const;
export type AcaoReparo = (typeof ACOES_REPARO)[number];

/** Estado em que uma operação PODE estar parada (códigos próprios do reparo; não são enums do banco). */
export const ESTADOS_DA_OPERACAO = [
  'RESERVA_ORFA',
  'ORDEM_SEM_TRANSACAO',
  'AGUARDANDO_ASSINATURA',
  'ENVIO_PRESO',
  'EM_TRANSITO_LONGO',
  'INCERTO',
  'FALHOU',
  'COMPROVADA_SEM_PAGAMENTO',
  'EMISSAO_PENDENTE',
  'EMISSAO_FALHOU',
  'EMISSAO_EXPIRADA',
  'PUBLICANDO_PRESO',
  'TENTATIVA_SEM_CONCLUSAO',
  'NA_REDE_SEM_REGISTRO',
] as const;
export type EstadoDaOperacao = (typeof ESTADOS_DA_OPERACAO)[number];

/** Classes de recuperação do §6.8: R retomável · P reparável (decisão/dado novo) · I só espera ou irreversível. */
export type ClasseDeRecuperacao = 'R' | 'P' | 'I';
export type PapelDoAdmin = 'OPERADOR' | 'APROVADOR';

export interface EntradaDoCatalogo {
  tipo: TipoOperacao;
  acao: AcaoReparo;
  /** Estados em que a ação é permitida (a função pura `estadoDeOrigem` abaixo). */
  estadosDeOrigem: readonly EstadoDaOperacao[];
  papelMinimo: PapelDoAdmin;
  /** Reautenticação (MFA recente) exigida. */
  stepUp: boolean;
  /** Dupla aprovação: quem pede ≠ quem aprova, por AdminUser.id (§5.4). */
  duplaAprovacao: boolean;
  classe: ClasseDeRecuperacao;
  /** A execução emite ou ancora algo na rede Stellar. */
  efeitoOnChain: boolean;
  /** Efeito que não se desfaz (pagamento, emissão, apagar direito). */
  irreversivel: boolean;
  /** `true` = não move valor: única categoria que pode ir à produção antes do T1 (C4, Argus). */
  semValor: boolean;
  /** Consulta obrigatória à rede/PSP ANTES de agir (C6: se já mostra o efeito, o resultado é JA_RESOLVIDO). */
  precondicao: string;
}

const e = (x: EntradaDoCatalogo): EntradaDoCatalogo => x;

export const CATALOGO_DE_REPAROS: readonly EntradaDoCatalogo[] = [
  // ── sem valor (C4): OPERADOR, sem step-up ────────────────────────────────────────────────────────────────
  e({ tipo: 'SWAP_ORFAO', acao: 'RECONCILIAR', estadosDeOrigem: ['RESERVA_ORFA'], papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, classe: 'R', efeitoOnChain: false, irreversivel: false, semValor: true, precondicao: 'prova pela conta do investidor no Horizon (sucesso → escritura; falha ou sequence consumida → libera)' }),
  e({ tipo: 'RESGATE_ORFAO', acao: 'RECONCILIAR', estadosDeOrigem: ['RESERVA_ORFA'], papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, classe: 'R', efeitoOnChain: false, irreversivel: false, semValor: true, precondicao: 'prova pela conta do investidor no Horizon' }),
  e({ tipo: 'PIX_SAIDA', acao: 'RECONSULTAR', estadosDeOrigem: ['EM_TRANSITO_LONGO', 'INCERTO'], papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, classe: 'R', efeitoOnChain: false, irreversivel: false, semValor: true, precondicao: 'só lê o PSP e avança o estado; nunca reenvia o pagamento' }),
  e({ tipo: 'CESSAO', acao: 'SINCRONIZAR', estadosDeOrigem: ['AGUARDANDO_ASSINATURA'], papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, classe: 'R', efeitoOnChain: false, irreversivel: false, semValor: true, precondicao: 'relê o envelope no DocuSign (a conclusão é idempotente pelo envelope)' }),
  e({ tipo: 'SNAPSHOT_NAV', acao: 'RETOMAR', estadosDeOrigem: ['PUBLICANDO_PRESO'], papelMinimo: 'OPERADOR', stepUp: false, duplaAprovacao: false, classe: 'R', efeitoOnChain: true, irreversivel: false, semValor: true, precondicao: 'idempotente por data; confere o memo no ledger antes de ancorar' }),
  // ── com valor (esperam o T1): step-up sempre; APROVADOR e dupla aprovação onde o Argus decidiu (C3) ───────
  e({ tipo: 'PIX_SAIDA', acao: 'REABRIR', estadosDeOrigem: ['FALHOU'], papelMinimo: 'APROVADOR', stepUp: true, duplaAprovacao: true, classe: 'P', efeitoOnChain: false, irreversivel: true, semValor: false, precondicao: 'reconsultar o pagamento original no PSP e exigir FALHOU definitivo com o id do PSP' }),
  e({ tipo: 'INCORPORACAO', acao: 'RETOMAR', estadosDeOrigem: ['EMISSAO_PENDENTE', 'EMISSAO_FALHOU', 'EMISSAO_EXPIRADA'], papelMinimo: 'OPERADOR', stepUp: true, duplaAprovacao: false, classe: 'R', efeitoOnChain: true, irreversivel: true, semValor: false, precondicao: 'consultar o Horizon pelo memoHash antes; nunca pelo reconciliador automático' }),
  e({ tipo: 'OFFRAMP', acao: 'CANCELAR_ORDEM', estadosDeOrigem: ['ORDEM_SEM_TRANSACAO'], papelMinimo: 'OPERADOR', stepUp: true, duplaAprovacao: false, classe: 'P', efeitoOnChain: false, irreversivel: true, semValor: false, precondicao: 'sem burnStellarTxHash na rede E ordem da Etherfuse cancelada ou expirada lá' }),
  e({ tipo: 'CLAWBACK', acao: 'CONSULTAR_REDE', estadosDeOrigem: ['INCERTO', 'TENTATIVA_SEM_CONCLUSAO'], papelMinimo: 'APROVADOR', stepUp: true, duplaAprovacao: false, classe: 'P', efeitoOnChain: false, irreversivel: false, semValor: false, precondicao: 'só REGISTRA o que a rede mostra pelo hash do envelope; incerto → failed só se o hash não está na rede E o maxTime já passou; nunca reexecuta' }),
];

/** Entrada do catálogo para o par; `undefined` se o par não existe (a action recusa). */
export function entradaDoCatalogo(tipo: TipoOperacao, acao: AcaoReparo): EntradaDoCatalogo | undefined {
  return CATALOGO_DE_REPAROS.find((x) => x.tipo === tipo && x.acao === acao);
}

/** Função PURA: a ação é permitida para este estado? Par fora do catálogo ou estado desconhecido → false. */
export function estadoDeOrigemValido(tipo: TipoOperacao, acao: AcaoReparo, estado: string): boolean {
  const ent = entradaDoCatalogo(tipo, acao);
  return !!ent && (ent.estadosDeOrigem as readonly string[]).includes(estado);
}

/** Ações do catálogo habilitadas para o estado em que o tipo está parado. */
export function acoesPermitidas(tipo: TipoOperacao, estado: string): AcaoReparo[] {
  return CATALOGO_DE_REPAROS.filter((x) => x.tipo === tipo && (x.estadosDeOrigem as readonly string[]).includes(estado)).map((x) => x.acao);
}
