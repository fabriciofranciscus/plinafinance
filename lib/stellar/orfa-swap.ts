/**
 * Desfecho do envelope de swap órfão (N1-S1(b); Argus, adendo 2 do parecer N1;
 * contratos/2026-11-10-n1-orfa-prova.md).
 *
 * A reserva do swap fica órfã quando o envelope (assinado pelo investidor e
 * co-assinado pela Plina) não teve desfecho visível. Liberar sem prova poderia
 * reabrir o NAV com mint sem caixa; travar para sempre deixa qualquer
 * investidor fechar o NAV da plataforma de propósito. Esta primitiva decide só
 * com PROVA, olhando a conta do INVESTIDOR (source do envelope):
 *   - ENTROU: a nossa tx consumiu a sequence S (ou achada pelo hash);
 *   - OUTRA_TX: S consumida por outra tx do investidor → a nossa morreu;
 *   - LIVRE_EXPIRADA: S livre e a rede já fechou ledger com closed_at >
 *     maxTime + espera (a tx não entra mais); o reconciliador vigia o hash 24 h;
 *   - AGUARDANDO: S livre, mas a rede ainda não passou do prazo + espera;
 *   - INDETERMINADO: a conta passou de S e a tx com S não aparece → operador.
 * Um 404 por hash nunca é prova sozinho. Erro do Horizon propaga (sem decisão).
 * O relógio local não decide nada.
 */
import { Transaction } from '@stellar/stellar-sdk';
import { horizon } from './account';
import { networkPassphrase } from './config';

export type SituacaoEnvelopeSwap =
  | { status: 'ENTROU'; hash: string; successful: boolean; ledger: number }
  | { status: 'OUTRA_TX'; hash: string }
  | { status: 'LIVRE_EXPIRADA'; sequenceConta: string; ledger: number; fechadoEm: string }
  | { status: 'AGUARDANDO'; liberaApos: number }
  | { status: 'INDETERMINADO'; motivo: string };

type RegistroTxConta = {
  hash: string;
  successful: boolean;
  ledger_attr?: number;
  paging_token: string;
  source_account: string;
  source_account_sequence: string;
};

const ESPERA_PADRAO_SEC = 600;
const PAGINA = 200;
const MAX_PAGINAS = 5;

function statusHttp(err: unknown): number | undefined {
  const e = err as { response?: { status?: number; data?: { status?: number } } };
  return e?.response?.status ?? e?.response?.data?.status;
}

async function buscarPorHash(
  hash: string,
): Promise<{ successful: boolean; ledger_attr?: number } | null> {
  try {
    return (await horizon.transactions().transaction(hash).call()) as unknown as {
      successful: boolean;
      ledger_attr?: number;
    };
  } catch (err) {
    if (statusHttp(err) === 404) return null;
    throw err;
  }
}

/** Procura, na conta do investidor, a tx que consumiu S (≤ 5 páginas, desc). */
async function consumidoraDaSequencia(
  conta: string,
  seq: string,
): Promise<RegistroTxConta | 'NAO_ACHOU'> {
  const alvo = BigInt(seq);
  let cursor: string | undefined;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    let q = horizon.transactions().forAccount(conta).order('desc').includeFailed(true).limit(PAGINA);
    if (cursor) q = q.cursor(cursor);
    const { records } = (await q.call()) as unknown as { records: RegistroTxConta[] };
    for (const r of records) {
      if (r.source_account !== conta) continue;
      const s = BigInt(r.source_account_sequence);
      if (s === alvo) return r;
      if (s < alvo) return 'NAO_ACHOU';
    }
    if (records.length < PAGINA) return 'NAO_ACHOU';
    cursor = records[records.length - 1].paging_token;
  }
  return 'NAO_ACHOU';
}

export async function situacaoEnvelopeSwap(
  xdr: string,
  opts?: { esperaSec?: number },
): Promise<SituacaoEnvelopeSwap> {
  const tx = new Transaction(xdr, networkPassphrase);
  const hash = tx.hash().toString('hex');
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (!maxTime) throw new Error('situacaoEnvelopeSwap: envelope sem maxTime');
  const espera = opts?.esperaSec ?? ESPERA_PADRAO_SEC;
  const conta = tx.source;
  const seq = tx.sequence;

  const direto = await buscarPorHash(hash);
  if (direto) {
    return { status: 'ENTROU', hash, successful: direto.successful, ledger: direto.ledger_attr ?? 0 };
  }

  const account = await horizon.loadAccount(conta);
  const seqConta = account.sequenceNumber();
  if (BigInt(seqConta) >= BigInt(seq)) {
    const r = await consumidoraDaSequencia(conta, seq);
    if (r === 'NAO_ACHOU') {
      return { status: 'INDETERMINADO', motivo: `conta em ${seqConta} e a tx com sequence ${seq} não aparece` };
    }
    if (r.hash === hash) {
      return { status: 'ENTROU', hash, successful: r.successful, ledger: r.ledger_attr ?? 0 };
    }
    return { status: 'OUTRA_TX', hash: r.hash };
  }

  const { records } = (await horizon.ledgers().order('desc').limit(1).call()) as unknown as {
    records: Array<{ sequence: number; closed_at: string }>;
  };
  const ultimo = records[0];
  if (!ultimo) throw new Error('situacaoEnvelopeSwap: Horizon sem ledgers');
  const liberaApos = maxTime + espera;
  const fechou = Math.floor(Date.parse(ultimo.closed_at) / 1000);
  if (fechou > liberaApos) {
    return { status: 'LIVRE_EXPIRADA', sequenceConta: seqConta, ledger: ultimo.sequence, fechadoEm: ultimo.closed_at };
  }
  return { status: 'AGUARDANDO', liberaApos };
}
