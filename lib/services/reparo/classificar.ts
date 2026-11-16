/**
 * Classificadores PUROS (T3, fatia 1): dada a linha de uma tabela e o "agora", dizem em que estado a operação está PARADA e desde quando,
 * ou `null` se não está parada. Sem banco, sem rede. A listagem (`operacoes-travadas.ts`) só filtra no banco e usa estas funções.
 *
 * Os prazos abaixo são PROVISÓRIOS (decisão c do desenho: Farol/Norma, §11.2). Mudar um prazo não muda nenhum contrato.
 */
import type { EstadoDaOperacao } from './catalogo';

export const PRAZOS_PROVISORIOS = {
  provisorio: true as const,
  /** Depois do maxTime da tx a reserva ainda espera este tempo (mesma espera do reconciliador N1) antes de contar como órfã. */
  reservaOrfaEsperaMs: 10 * 60_000,
  /** Pix em ENVIANDO/PROCESSANDO além disto (mesmo alvo do alerta do varredor: 30 min). */
  pixEmTransitoMs: 30 * 60_000,
  /** Ordem de saída pendente sem transação além disto. */
  offrampSemTransacaoMs: 30 * 60_000,
  /** Termo enviado e ainda sem assinatura além disto (informativo: a pessoa pode estar só demorando). */
  cessaoAguardandoMs: 72 * 3600_000,
  /** Claim de envio ao DocuSign sem envelope além disto (a janela do claim é de 5 min). */
  cessaoEnvioPresoMs: 10 * 60_000,
  /** Depois do maxTime da emissão, margem de 10 s (a tx não entra mais). */
  emissaoMargemMs: 10_000,
  /** Lease do snapshot vencido há mais que isto, ou PUBLICANDO sem lease e mais velho que `snapshotSemLeaseMs`. */
  snapshotLeaseVencidoMs: 5 * 60_000,
  snapshotSemLeaseMs: 30 * 60_000,
  /** Clawback em attempting/onchain/incerto além disto. */
  clawbackMs: 10 * 60_000,
} as const;

export interface Classificacao {
  estado: EstadoDaOperacao;
  desde: Date;
}

const idade = (desde: Date, agora: Date) => agora.getTime() - desde.getTime();

/** Reserva do swap (`Quote`) ou do resgate (`ResgateCotacao`): hash reservado, não consumida, e o prazo da tx já passou + espera. */
export function classificarReservaOrfa(
  r: { submitXdrHash: string | null; consumedAt: Date | null; submitMaxTime: Date | null },
  agora: Date,
): Classificacao | null {
  if (!r.submitXdrHash || r.consumedAt || !r.submitMaxTime) return null;
  return idade(r.submitMaxTime, agora) > PRAZOS_PROVISORIOS.reservaOrfaEsperaMs ? { estado: 'RESERVA_ORFA', desde: r.submitMaxTime } : null;
}

export function classificarPix(
  t: { status: 'ENVIANDO' | 'PROCESSANDO' | 'INCERTO' | 'FALHOU' | 'COMPROVADA'; criadoEm: Date; temPagamento: boolean },
  agora: Date,
): Classificacao | null {
  if (t.status === 'INCERTO') return { estado: 'INCERTO', desde: t.criadoEm };
  if (t.status === 'FALHOU') return { estado: 'FALHOU', desde: t.criadoEm };
  if (t.status === 'COMPROVADA') return t.temPagamento ? null : { estado: 'COMPROVADA_SEM_PAGAMENTO', desde: t.criadoEm };
  // ENVIANDO / PROCESSANDO. A idade conta da CRIAÇÃO: a reabertura não zera o relógio aqui (conservador: pode listar antes do varredor).
  return idade(t.criadoEm, agora) > PRAZOS_PROVISORIOS.pixEmTransitoMs ? { estado: 'EM_TRANSITO_LONGO', desde: t.criadoEm } : null;
}

export function classificarOffRamp(o: { status: string; burnStellarTxHash: string | null; criadoEm: Date }, agora: Date): Classificacao | null {
  if (o.status !== 'pending' || o.burnStellarTxHash) return null;
  return idade(o.criadoEm, agora) > PRAZOS_PROVISORIOS.offrampSemTransacaoMs ? { estado: 'ORDEM_SEM_TRANSACAO', desde: o.criadoEm } : null;
}

export function classificarCessao(
  c: { status: string; criadaEm: Date; docusignEnvioIniciadoEm: Date | null; docusignEnvelopeId: string | null },
  agora: Date,
): Classificacao | null {
  if (c.status === 'ENVIADA_DOCUSIGN') {
    return idade(c.criadaEm, agora) > PRAZOS_PROVISORIOS.cessaoAguardandoMs ? { estado: 'AGUARDANDO_ASSINATURA', desde: c.criadaEm } : null;
  }
  if (c.status === 'PENDENTE' && !c.docusignEnvelopeId && c.docusignEnvioIniciadoEm) {
    return idade(c.docusignEnvioIniciadoEm, agora) > PRAZOS_PROVISORIOS.cessaoEnvioPresoMs ? { estado: 'ENVIO_PRESO', desde: c.docusignEnvioIniciadoEm } : null;
  }
  return null;
}

export function classificarIncorporacao(t: { status: string; maxTime: Date }, agora: Date): Classificacao | null {
  if (t.status === 'FALHOU') return { estado: 'EMISSAO_FALHOU', desde: t.maxTime };
  if (t.status === 'EXPIRADA') return { estado: 'EMISSAO_EXPIRADA', desde: t.maxTime };
  if (t.status === 'PENDENTE') return idade(t.maxTime, agora) > PRAZOS_PROVISORIOS.emissaoMargemMs ? { estado: 'EMISSAO_PENDENTE', desde: t.maxTime } : null;
  return null;
}

export function classificarSnapshotNav(s: { status: string; travaAte: Date | null; criadoEm: Date }, agora: Date): Classificacao | null {
  if (s.status !== 'PUBLICANDO') return null;
  if (s.travaAte) return idade(s.travaAte, agora) > PRAZOS_PROVISORIOS.snapshotLeaseVencidoMs ? { estado: 'PUBLICANDO_PRESO', desde: s.travaAte } : null;
  return idade(s.criadoEm, agora) > PRAZOS_PROVISORIOS.snapshotSemLeaseMs ? { estado: 'PUBLICANDO_PRESO', desde: s.criadoEm } : null;
}

/** `status` vem de `EventoAudit.payloadJson.status` do CLAWBACK_EXECUTADO (U1-11). */
export function classificarClawback(ev: { status: string; criadoEm: Date }, agora: Date): Classificacao | null {
  const estado: EstadoDaOperacao | null =
    ev.status === 'attempting' ? 'TENTATIVA_SEM_CONCLUSAO' : ev.status === 'onchain' ? 'NA_REDE_SEM_REGISTRO' : ev.status === 'incerto' ? 'INCERTO' : null;
  if (!estado) return null;
  return idade(ev.criadoEm, agora) > PRAZOS_PROVISORIOS.clawbackMs ? { estado, desde: ev.criadoEm } : null;
}
