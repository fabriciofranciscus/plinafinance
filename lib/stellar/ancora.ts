/**
 * Âncora de SHA-256 a partir do distributor (E3-1 snapshot do NAV, DS3 PDF
 * assinado). A tx é um self-payment de 0.0000001 XLM do distributor com
 * `Memo.hash` = o SHA-256 do arquivo: o revisor confere `memo = SHA-256 do
 * arquivo` no explorer, sem confiar no banco.
 *
 * Idempotente: antes de submeter, procura no histórico do distributor uma
 * âncora com o mesmo hash. No envio, erro ambíguo reenvia o MESMO envelope
 * até o prazo dele (não há como ancorar duas vezes com um envelope só).
 *
 * Contrato: contratos/2026-11-11-ancora-sha256-distributor.md.
 */
import { Asset, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { horizon } from './account';
import { STELLAR_TX_TIMEOUT_SEC, networkPassphrase } from './config';
import { getDynamicFee } from './fee';
import { buscarTxPorHash, submitEnvelope } from './issuer';
import { distributorSigner } from './signer';

export type AncoraContexto = 'SNAPSHOT_NAV' | 'DOCUSIGN_PDF';
export type AncoraErrorCode =
  | 'ANCORA_HASH_INVALIDO'
  | 'ANCORA_FALHOU'
  | 'ANCORA_NAO_CONFIRMADA'
  | 'ANCORA_DUPLICADA'
  | 'ANCORA_HISTORICO_EXCEDE_LIMITE';

const MENSAGENS: Record<AncoraErrorCode, string> = {
  ANCORA_HASH_INVALIDO: 'Âncora recusada: o hash precisa ser SHA-256 em hex (64 caracteres).',
  ANCORA_FALHOU: 'Âncora recusada pela rede; nada foi ancorado. Repetir é seguro.',
  ANCORA_NAO_CONFIRMADA:
    'Âncora não entrou no ledger até o prazo da transação; nada foi ancorado. Repetir é seguro.',
  ANCORA_DUPLICADA: 'Há mais de uma âncora com o mesmo hash: operador precisa conferir.',
  ANCORA_HISTORICO_EXCEDE_LIMITE:
    'Histórico do distributor grande demais para afirmar que o hash não foi ancorado.',
};

export class AncoraError extends Error {
  readonly code: AncoraErrorCode;
  readonly txHash?: string;
  readonly resultCodes?: unknown;

  constructor(code: AncoraErrorCode, extra: { txHash?: string; resultCodes?: unknown } = {}) {
    super(MENSAGENS[code]);
    this.name = 'AncoraError';
    this.code = code;
    this.txHash = extra.txHash;
    this.resultCodes = extra.resultCodes;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PAGINA = 200;
const MAX_PAGINAS = 50;
const INTERVALO_MS = 5_000;
const FOLGA_SEC = 10;
/** Folga antes do `desde` (criação do claim) na busca de âncora existente (S3 do Argus). */
const FOLGA_DESDE_MS = 60 * 60 * 1000;
/** `desde` aceito até 5 min à frente do relógio (folga de relógio); além disso esconderia âncora recente. */
const FUTURO_MAX_MS = 5 * 60 * 1000;
/** Com `desde`, o mesmo teto de 50 páginas (10.000 txs) — decisão do Atlas. */
const MAX_PAGINAS_COM_DESDE = 50;

type Relogio = { agora: () => number; dormir: (ms: number) => Promise<void> };
const REAL: Relogio = { agora: () => Date.now(), dormir: (ms) => new Promise((r) => setTimeout(r, ms)) };
let relogio: Relogio = REAL;
/** Só para testes. */
export function _setRelogioAncoraForTests(r?: Partial<Relogio>): void {
  relogio = { ...REAL, ...r };
}

function exigirHash(sha256Hex: unknown): asserts sha256Hex is string {
  if (typeof sha256Hex !== 'string' || !SHA256_HEX.test(sha256Hex)) {
    throw new AncoraError('ANCORA_HASH_INVALIDO');
  }
}

type TxRec = {
  hash: string;
  successful: boolean;
  source_account: string;
  memo_type: string;
  memo?: string;
  created_at: string;
};
type PaginaTx = { records: TxRec[]; next(): Promise<PaginaTx> };

/**
 * Âncora já feita para este hash, ou `null`. Com `desde` (criação do claim),
 * lê as txs do distributor em ordem decrescente e PARA na primeira anterior a
 * `desde − 1 h` (S3 do Argus): o custo não cresce com o histórico (teto de
 * 10.000 txs, created_at ilegível → erro; `desde` > agora + 5 min → erro). Sem
 * `desde`, lê até 10.000 txs e, passando disso, ANCORA_HISTORICO_EXCEDE_LIMITE.
 * Limitação: a idempotência vale dentro da vida do claim (âncora mais velha que
 * `desde − 1 h` não é vista; custo de uma âncora a mais, sem perda de prova).
 */
export async function buscarAncora(
  sha256Hex: string,
  opts?: { desde?: Date },
): Promise<{ txHash: string; ledgerCloseTime: string } | null> {
  exigirHash(sha256Hex);
  let corte: number | null = null;
  if (opts?.desde !== undefined) {
    const t = opts.desde instanceof Date ? opts.desde.getTime() : NaN;
    if (!Number.isFinite(t)) throw new Error('buscarAncora: desde inválido');
    if (t > relogio.agora() + FUTURO_MAX_MS) throw new Error('buscarAncora: desde no futuro');
    corte = t - FOLGA_DESDE_MS;
  }
  const dist = distributorSigner().publicKey();
  const memoB64 = Buffer.from(sha256Hex, 'hex').toString('base64');
  const achadas: TxRec[] = [];
  let pagina = (await horizon
    .transactions()
    .forAccount(dist)
    .order('desc')
    .limit(PAGINA)
    .call()) as unknown as PaginaTx;
  ler: for (let n = 1; pagina.records.length > 0; n++) {
    if (n > (corte === null ? MAX_PAGINAS : MAX_PAGINAS_COM_DESDE)) {
      throw new AncoraError('ANCORA_HISTORICO_EXCEDE_LIMITE');
    }
    for (const tx of pagina.records) {
      if (corte !== null) {
        const criada = Date.parse(tx.created_at);
        // created_at ilegível: não dá para saber onde parar → falha fechada, como histórico grande demais.
        if (!Number.isFinite(criada)) throw new AncoraError('ANCORA_HISTORICO_EXCEDE_LIMITE');
        if (criada < corte) break ler;
      }
      if (tx.successful && tx.source_account === dist && tx.memo_type === 'hash' && tx.memo === memoB64) {
        achadas.push(tx);
      }
    }
    pagina = await pagina.next();
  }
  if (achadas.length > 1) throw new AncoraError('ANCORA_DUPLICADA', { txHash: achadas[0].hash });
  const a = achadas[0];
  return a ? { txHash: a.hash, ledgerCloseTime: a.created_at } : null;
}

/** Ancora o hash (ou devolve a âncora existente). */
export async function ancorarSha256(input: {
  sha256Hex: string;
  contexto: AncoraContexto;
  /** Criação do claim (S3): limita a busca de âncora existente. OBRIGATÓRIO (decisão do Atlas). */
  desde: Date;
}): Promise<{ txHash: string; reutilizada: boolean; ledgerCloseTime: string }> {
  exigirHash(input.sha256Hex);
  if (!(input.desde instanceof Date)) throw new Error('ancorarSha256: desde (criação do claim) é obrigatório');
  const existente = await buscarAncora(input.sha256Hex, { desde: input.desde });
  if (existente) return { ...existente, reutilizada: true };

  const signer = distributorSigner();
  const conta = await horizon.loadAccount(signer.publicKey());
  const tx = new TransactionBuilder(conta, { fee: await getDynamicFee(), networkPassphrase })
    .addOperation(
      Operation.payment({ destination: signer.publicKey(), asset: Asset.native(), amount: '0.0000001' }),
    )
    .addMemo(Memo.hash(Buffer.from(input.sha256Hex, 'hex')))
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();
  signer.sign(tx);
  const xdr = tx.toXDR();
  const hash = tx.hash().toString('hex');
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);

  const confirmada = async () => {
    const r = await buscarTxPorHash(hash);
    if (r.found && r.successful) return { txHash: hash, reutilizada: false, ledgerCloseTime: r.ledgerCloseTime };
    if (r.found) throw new AncoraError('ANCORA_FALHOU', { txHash: hash, resultCodes: { transaction: 'tx_failed' } });
    return null;
  };

  const primeiro = await submitEnvelope(xdr);
  if (primeiro.status === 'SUCCESS') {
    return (await confirmada()) ?? { txHash: hash, reutilizada: false, ledgerCloseTime: new Date().toISOString() };
  }
  if (primeiro.status === 'FAILED') {
    throw new AncoraError('ANCORA_FALHOU', { txHash: hash, resultCodes: primeiro.resultCodes });
  }
  while (relogio.agora() < (maxTime + FOLGA_SEC) * 1000) {
    await relogio.dormir(INTERVALO_MS);
    let ok: Awaited<ReturnType<typeof confirmada>> = null;
    try {
      ok = await confirmada();
    } catch (err) {
      if (err instanceof AncoraError) throw err;
      continue; // Horizon instável no meio: a consulta final decide.
    }
    if (ok) return ok;
    if (relogio.agora() < maxTime * 1000) {
      const r = await submitEnvelope(xdr);
      if (r.status === 'SUCCESS') return (await confirmada()) ?? { txHash: hash, reutilizada: false, ledgerCloseTime: new Date().toISOString() };
      const codigo = (r as { resultCodes?: { transaction?: string } }).resultCodes?.transaction;
      if (r.status === 'FAILED' && codigo !== 'tx_too_late') {
        throw new AncoraError('ANCORA_FALHOU', { txHash: hash, resultCodes: r.resultCodes });
      }
    }
  }
  const final = await confirmada(); // erro aqui propaga
  if (final) return final;
  throw new AncoraError('ANCORA_NAO_CONFIRMADA', { txHash: hash });
}

/** Para o revisor e o E1-P: a tx existe, deu certo, saiu do distributor e o memo é o hash. */
export async function verificarAncora(input: {
  txHash: string;
  sha256Hex: string;
}): Promise<{
  confere: boolean;
  motivo?: 'NAO_ENCONTRADA' | 'FALHOU' | 'MEMO_DIVERGE' | 'FONTE_DIVERGE';
  ledgerCloseTime?: string;
}> {
  exigirHash(input.sha256Hex);
  let tx: TxRec;
  try {
    tx = (await horizon.transactions().transaction(input.txHash).call()) as unknown as TxRec;
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      return { confere: false, motivo: 'NAO_ENCONTRADA' };
    }
    throw err;
  }
  if (!tx.successful) return { confere: false, motivo: 'FALHOU' };
  if (tx.source_account !== distributorSigner().publicKey()) return { confere: false, motivo: 'FONTE_DIVERGE' };
  const memoB64 = Buffer.from(input.sha256Hex, 'hex').toString('base64');
  if (tx.memo_type !== 'hash' || tx.memo !== memoB64) return { confere: false, motivo: 'MEMO_DIVERGE' };
  return { confere: true, ledgerCloseTime: tx.created_at };
}
