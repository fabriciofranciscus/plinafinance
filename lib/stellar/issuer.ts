import {
  Account,
  AuthClawbackEnabledFlag,
  type AuthFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';
import { buildAsset, horizon, warnIfBalanceBelowFloor } from './account';
import {
  DISTRIBUTOR_BALANCE_FLOOR,
  ISSUER_BALANCE_FLOOR,
  STELLAR_NETWORK,
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
  networkPassphrase,
} from './config';
import { assetCodeForClasse } from './classes';
import { getDynamicFee } from './fee';
import type { StellarSigner } from './signer';
import { withSpan } from '../observability/tracer';

/**
 * Wrappers Stellar usados pelo POC e pelo MVP.
 *
 * Política institucional (whitepaper §3.2 + §6.5):
 *   AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED no issuer.
 *   Clawback limitado a 4 hipóteses; cada acionamento deve registrar
 *   motivo + fundamento em audit log ANTES de chamar `executeClawback`.
 *
 * Regra do CLAUDE.md: DB só atualiza APÓS sucesso on-chain. Esse módulo
 * NÃO toca o DB — orquestração fica em `lib/services/*`.
 */

type SubmitResult = Horizon.HorizonApi.SubmitTransactionResponse;

async function buildSourceTx(
  source: StellarSigner,
  floor?: { xlm: string | number; label: string },
) {
  const account = await horizon.loadAccount(source.publicKey());
  if (floor) warnIfBalanceBelowFloor(account.balances, floor.xlm, floor.label);
  const builder = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  });
  return { source, builder };
}

async function sign(
  builder: TransactionBuilder,
  signers: StellarSigner[],
): Promise<SubmitResult> {
  const tx = builder.setTimeout(STELLAR_TX_TIMEOUT_SEC).build();
  signers.forEach((s) => s.sign(tx));
  return withSpan(
    'stellar.submit',
    { 'stellar.flow': 'issuer', 'stellar.network': STELLAR_NETWORK },
    async (span) => {
      const res = await horizon.submitTransaction(tx);
      span.setAttribute('stellar.tx_hash', res.hash);
      return res;
    },
  );
}

export async function configureIssuerFlags(
  issuer: StellarSigner,
  homeDomain?: string,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  // Bitmask OR de constantes numéricas vira `number`; o SDK tipa `setFlags`
  // como `AuthFlag`. Cast é necessário — TS não infere bitmasks combinados.
  const flags = (AuthRequiredFlag |
    AuthRevocableFlag |
    AuthClawbackEnabledFlag) as AuthFlag;

  builder.addOperation(
    Operation.setOptions({
      setFlags: flags,
      homeDomain,
    }),
  );
  return sign(builder, [source]);
}

export async function createTrustline(
  holder: StellarSigner,
  issuerPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(holder);
  builder.addOperation(
    Operation.changeTrust({ asset: buildAsset(issuerPubkey, code) }),
  );
  return sign(builder, [source]);
}

export async function authorizeTrustline(
  issuer: StellarSigner,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.setTrustLineFlags({
      trustor: holderPubkey,
      asset: buildAsset(source.publicKey(), code),
      flags: { authorized: true },
    }),
  );
  return sign(builder, [source]);
}

export async function revokeTrustline(
  issuer: StellarSigner,
  holderPubkey: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.setTrustLineFlags({
      trustor: holderPubkey,
      asset: buildAsset(source.publicKey(), code),
      flags: { authorized: false },
    }),
  );
  return sign(builder, [source]);
}

export type IssueAssetErrorCode =
  | 'ISSUE_CODE_UNKNOWN'
  | 'ISSUE_AMOUNT_INVALID'
  | 'ISSUE_MEMO_INVALID'
  | 'ISSUE_SUBSTITUICAO_INVALIDA';

const MENSAGENS_ISSUE: Record<IssueAssetErrorCode, string> = {
  ISSUE_CODE_UNKNOWN: 'Emissão recusada: asset code ausente ou fora da Plina.',
  ISSUE_AMOUNT_INVALID: 'Emissão recusada: amount precisa ser string > 0 com até 7 casas.',
  ISSUE_MEMO_INVALID: 'Emissão recusada: memoHash precisa ter exatamente 32 bytes.',
  ISSUE_SUBSTITUICAO_INVALIDA:
    'Substituição recusada: o envelope anterior é inválido, é de outra emissão ou ainda não expirou na rede.',
};

/** Entrada recusada por `issueAsset` antes de qualquer rede ou assinatura. */
export class IssueAssetInputError extends Error {
  readonly code: IssueAssetErrorCode;

  constructor(code: IssueAssetErrorCode) {
    super(MENSAGENS_ISSUE[code]);
    this.name = 'IssueAssetInputError';
    this.code = code;
  }
}

/** Amount Stellar: inteiro de até 12 dígitos, opcionalmente com 1–7 casas. */
const ISSUE_AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;
const STELLAR_MAX_STROOPS = BigInt('9223372036854775807');

function amountEmStroops(amount: string): bigint {
  const [inteiro, frac = ''] = amount.split('.');
  return BigInt(inteiro) * BigInt(10_000_000) + BigInt(frac.padEnd(7, '0'));
}

function assertCodeDaPlina(code: unknown): asserts code is string {
  const codesDaPlina = [assetCodeForClasse('SENIOR'), assetCodeForClasse('SUBORDINADA')];
  if (typeof code !== 'string' || !codesDaPlina.includes(code)) {
    throw new IssueAssetInputError('ISSUE_CODE_UNKNOWN');
  }
}

/** Memo.hash da emissão: exatamente 32 bytes (ex.: sha256 da chave da cessão). */
function assertMemoHash(memoHash: unknown): asserts memoHash is Buffer {
  if (!Buffer.isBuffer(memoHash) || memoHash.length !== 32) {
    throw new IssueAssetInputError('ISSUE_MEMO_INVALID');
  }
}

function assertIssueInput(amount: unknown, code: unknown): void {
  assertCodeDaPlina(code);
  if (typeof amount !== 'string' || !ISSUE_AMOUNT.test(amount)) {
    throw new IssueAssetInputError('ISSUE_AMOUNT_INVALID');
  }
  const stroops = amountEmStroops(amount);
  if (stroops <= BigInt(0) || stroops > STELLAR_MAX_STROOPS) {
    throw new IssueAssetInputError('ISSUE_AMOUNT_INVALID');
  }
}

/**
 * Emite tokens do issuer para uma conta autorizada (tipicamente distributor).
 * Idempotência: o caller deve garantir antes de chamar (lookup no banco por
 * `Cota.emissaoTxHash`).
 *
 * `code` é obrigatório (sem default): emitir a classe errada é erro de
 * dinheiro. Code fora da Plina, ou amount que não seja string > 0 com até 7
 * casas, é recusado com `IssueAssetInputError` antes de carregar a conta ou
 * assinar (fail-closed).
 *
 * `opts.memoHash` (32 bytes) vai como `Memo.hash` na tx: é a chave de
 * idempotência da emissão. Depois de um crash entre o submit e o commit no
 * banco, `buscarEmissaoPorMemo` acha a emissão já feita e o caller não
 * reemite (E1-4, contrato 2026-11-10-e1-4-emissao-idempotente).
 */
export async function issueAsset(
  issuer: StellarSigner,
  destinationPubkey: string,
  amount: string,
  code: string,
  opts?: { memoHash?: Buffer; sequenceDe?: string },
): Promise<SubmitResult> {
  const envelope = await buildIssueAssetTx(issuer, destinationPubkey, amount, code, opts);
  return confirmarEmissao(envelope, opts?.sequenceDe);
}

// ── Erro ambíguo na emissão (E1-4; contrato 2026-11-10-reemissao-erro-ambiguo) ──

/**
 * - EMISSAO_FALHOU: a rede recusou a tx; nada foi emitido.
 * - EMISSAO_NAO_CONFIRMADA: a tx expirou na rede sem entrar (txExpirouNaRede = EXPIROU).
 *   Reexecutar só é seguro SUBSTITUINDO com `sequenceDe` = envelope desta tentativa (mesma
 *   sequence): se ela tiver entrado sem o Horizon mostrar, a substituição volta tx_bad_seq.
 *   Reexecutar sem `sequenceDe` (sequence nova) NÃO é seguro.
 * - EMISSAO_SEQUENCIA_CONSUMIDA: na substituição, a sequence já foi consumida e a tentativa
 *   anterior não aparece como emitida. Definitivo para o operador; nunca uma terceira tx automática.
 */
export type EmissaoErrorCode =
  | 'EMISSAO_FALHOU'
  | 'EMISSAO_NAO_CONFIRMADA'
  | 'EMISSAO_SEQUENCIA_CONSUMIDA';

const MENSAGENS_EMISSAO: Record<EmissaoErrorCode, string> = {
  EMISSAO_FALHOU: 'Emissão recusada pela rede; nada foi emitido. Reexecutar é seguro.',
  EMISSAO_NAO_CONFIRMADA:
    'Emissão não entrou no ledger até o prazo da transação; nada foi emitido. Reexecutar só substituindo com a mesma sequence (sequenceDe).',
  EMISSAO_SEQUENCIA_CONSUMIDA:
    'A sequence da tentativa anterior já foi consumida e ela não aparece como emitida. Não reemitir: o operador confere no explorer.',
};

/** Desfecho conclusivo da emissão (ver EmissaoErrorCode). */
export class EmissaoError extends Error {
  readonly code: EmissaoErrorCode;
  readonly hash: string;
  readonly resultCodes?: unknown;
  readonly maxTime?: number;

  constructor(
    code: EmissaoErrorCode,
    hash: string,
    extra: { resultCodes?: unknown; maxTime?: number } = {},
  ) {
    super(MENSAGENS_EMISSAO[code]);
    this.name = 'EmissaoError';
    this.code = code;
    this.hash = hash;
    this.resultCodes = extra.resultCodes;
    this.maxTime = extra.maxTime;
  }
}

/**
 * Confere que `sequenceDe` é o envelope de uma tentativa da MESMA emissão (mesma conta-fonte,
 * memo, destino, valor e asset) e devolve a tx anterior. Antes de qualquer rede ou assinatura.
 */
function txAnteriorDaMesmaEmissao(
  sequenceDe: unknown,
  issuer: StellarSigner,
  destinationPubkey: string,
  amount: string,
  code: string,
  memoHash: Buffer | undefined,
): Transaction {
  const invalida = () => new IssueAssetInputError('ISSUE_SUBSTITUICAO_INVALIDA');
  if (typeof sequenceDe !== 'string') throw invalida();
  let anterior: Transaction;
  try {
    anterior = new Transaction(sequenceDe, networkPassphrase);
  } catch {
    throw invalida();
  }
  if (anterior.source !== issuer.publicKey()) throw invalida();
  const memoAnterior = anterior.memo.type === 'hash' ? Buffer.from(anterior.memo.value as Buffer) : null;
  if ((memoAnterior === null) !== (memoHash === undefined)) throw invalida();
  if (memoAnterior && memoHash && !memoAnterior.equals(memoHash)) throw invalida();
  const op = anterior.operations[0] as Partial<Operation.Payment> | undefined;
  if (
    anterior.operations.length !== 1 ||
    op?.type !== 'payment' ||
    op.destination !== destinationPubkey ||
    op.asset?.getCode() !== code ||
    op.asset?.getIssuer() !== issuer.publicKey() ||
    amountEmStroops(op.amount ?? '0') !== amountEmStroops(amount)
  ) {
    throw invalida();
  }
  return anterior;
}

/**
 * Monta e assina (com o issuer) a tx de emissão, sem submeter. Devolve o
 * envelope, o hash, o `maxTime` e a `sequence`: quem persiste a tentativa antes
 * do submit (Bento, `TentativaEmissao`) reenvia exatamente este envelope.
 *
 * Substituição (`sequenceDe` = envelope da tentativa anterior): sem loadAccount,
 * a nova tx reutiliza a MESMA sequence. Se a anterior tiver entrado, a nova
 * volta tx_bad_seq e nada sai duas vezes (contratos/2026-11-10-substituicao-mesma-sequence.md).
 * Condição extra (R1 do Argus): só monta se txExpirouNaRede(anterior) = EXPIROU.
 */
export async function buildIssueAssetTx(
  issuer: StellarSigner,
  destinationPubkey: string,
  amount: string,
  code: string,
  opts?: { memoHash?: Buffer; sequenceDe?: string },
): Promise<{ xdr: string; hash: string; maxTime: number; sequence: string }> {
  assertIssueInput(amount, code);
  if (opts && 'memoHash' in opts) assertMemoHash(opts.memoHash);
  let source: StellarSigner;
  let builder: TransactionBuilder;
  if (opts && 'sequenceDe' in opts) {
    const anterior = txAnteriorDaMesmaEmissao(
      opts.sequenceDe,
      issuer,
      destinationPubkey,
      amount,
      code,
      opts.memoHash,
    );
    const situacao = await txExpirouNaRede(opts.sequenceDe as string);
    if (situacao.status !== 'EXPIROU') throw new IssueAssetInputError('ISSUE_SUBSTITUICAO_INVALIDA');
    const conta = new Account(issuer.publicKey(), (BigInt(anterior.sequence) - BigInt(1)).toString());
    source = issuer;
    builder = new TransactionBuilder(conta, { fee: await getDynamicFee(), networkPassphrase });
  } else {
    ({ source, builder } = await buildSourceTx(issuer, {
      xlm: ISSUER_BALANCE_FLOOR,
      label: 'issuer',
    }));
  }
  builder.addOperation(
    Operation.payment({
      destination: destinationPubkey,
      asset: buildAsset(source.publicKey(), code),
      amount,
    }),
  );
  if (opts?.memoHash) builder.addMemo(Memo.hash(opts.memoHash));
  const tx = builder.setTimeout(STELLAR_TX_TIMEOUT_SEC).build();
  source.sign(tx);
  return {
    xdr: tx.toXDR(),
    hash: tx.hash().toString('hex'),
    maxTime: Number(tx.timeBounds?.maxTime ?? 0),
    sequence: tx.sequence,
  };
}

export type EnvelopeResult =
  | { status: 'SUCCESS'; hash: string; response: SubmitResult }
  | { status: 'FAILED'; hash: string; resultCodes: unknown }
  | { status: 'AMBIGUOUS'; hash: string; reason: string };

type ErroHorizon = {
  code?: string;
  name?: string;
  response?: {
    status?: number;
    data?: { status?: number; extras?: { result_codes?: unknown } };
    extras?: { result_codes?: unknown };
  };
};

function resultCodesDe(err: unknown): { transaction?: string } | undefined {
  const e = err as ErroHorizon;
  return (e?.response?.data?.extras?.result_codes ?? e?.response?.extras?.result_codes) as
    | { transaction?: string }
    | undefined;
}

function statusHttpDe(err: unknown): number | undefined {
  const e = err as ErroHorizon;
  return e?.response?.status ?? e?.response?.data?.status;
}

type RegistroTx = {
  hash: string;
  successful: boolean;
  ledger_attr?: number;
  created_at: string;
  envelope_xdr: string;
  result_xdr: string;
  result_meta_xdr: string;
  paging_token: string;
};

async function buscarRegistroTx(hash: string): Promise<RegistroTx | null> {
  try {
    return (await horizon.transactions().transaction(hash).call()) as unknown as RegistroTx;
  } catch (err) {
    if (statusHttpDe(err) === 404) return null;
    throw err;
  }
}

function respostaDoRegistro(r: RegistroTx): SubmitResult {
  return {
    hash: r.hash,
    ledger: r.ledger_attr ?? 0,
    successful: r.successful,
    envelope_xdr: r.envelope_xdr,
    result_xdr: r.result_xdr,
    result_meta_xdr: r.result_meta_xdr,
    paging_token: r.paging_token,
  } as SubmitResult;
}

/**
 * Busca a tx pelo hash. 404 → `{ found: false }`; qualquer outro erro do
 * Horizon PROPAGA — nunca vira "não achou".
 */
export async function buscarTxPorHash(
  hash: string,
): Promise<{ found: true; successful: boolean; ledgerCloseTime: string } | { found: false }> {
  const r = await buscarRegistroTx(hash);
  return r ? { found: true, successful: r.successful, ledgerCloseTime: r.created_at } : { found: false };
}

// ── Expiração decidida pela rede (R1 do Argus, revisoes/2026-11-10-parecer-argus-e1-4-chain.md) ──

export type ExpiracaoNaRede =
  | { status: 'ENTROU'; hash: string; successful: boolean; ledger: number }
  | { status: 'EXPIROU'; hash: string; maxTime: number; ledgerAposPrazo: number; fechadoEm: string }
  | { status: 'EM_ABERTO'; hash: string; maxTime: number };

type RegistroLedger = {
  sequence: number;
  closed_at: string;
  paging_token: string;
  successful_transaction_count: number;
  failed_transaction_count: number;
};

/** A tx pode ter entrado até ~5 min antes do horário local de montagem (relógio adiantado). */
const FOLGA_RELOGIO_SEC = 300;
const PAGINA_HORIZON = 200;
const MAX_LEDGERS_JANELA = 1_000;
const MAX_SONDAGENS = 64;

const fechouEm = (l: RegistroLedger) => Math.floor(Date.parse(l.closed_at) / 1000);

function indeterminado(motivo: string): Error {
  return new Error(`Expiração indeterminada: ${motivo}. Não reemitir; consultar de novo.`);
}

async function ledgerPorSequencia(seq: number): Promise<RegistroLedger> {
  return (await horizon.ledgers().ledger(seq).call()) as unknown as RegistroLedger;
}

/** Primeiro ledger com closeTime > maxTime (busca galopante + binária; registros imutáveis). */
async function primeiroLedgerAposPrazo(
  ultimo: RegistroLedger,
  maxTime: number,
): Promise<RegistroLedger> {
  let alto = ultimo;
  let baixo: RegistroLedger | null = null;
  let passo = Math.max(1, Math.ceil((fechouEm(ultimo) - maxTime) / 5));
  let sondagens = 0;
  while (!baixo) {
    if (++sondagens > MAX_SONDAGENS) throw indeterminado('busca do ledger do prazo excedeu o limite');
    const seq = alto.sequence - passo;
    if (seq < 1) throw indeterminado('histórico do Horizon não alcança o prazo');
    const l = await ledgerPorSequencia(seq);
    if (fechouEm(l) <= maxTime) baixo = l;
    else alto = l;
    passo *= 2;
  }
  while (alto.sequence - baixo.sequence > 1) {
    if (++sondagens > MAX_SONDAGENS) throw indeterminado('busca do ledger do prazo excedeu o limite');
    const l = await ledgerPorSequencia(Math.floor((alto.sequence + baixo.sequence) / 2));
    if (fechouEm(l) <= maxTime) baixo = l;
    else alto = l;
  }
  return alto;
}

/**
 * Procura o hash nas txs de um ledger. A lista tem de bater com a contagem
 * do registro do ledger (imutável): instância atrasada ou parcial → erro.
 */
async function txNoLedger(l: RegistroLedger, hash: string): Promise<RegistroTx | null> {
  const esperado = l.successful_transaction_count + l.failed_transaction_count;
  if (esperado === 0) return null;
  let vistos = 0;
  let cursor: string | undefined;
  for (;;) {
    let q = horizon.transactions().forLedger(l.sequence).includeFailed(true).order('asc').limit(PAGINA_HORIZON);
    if (cursor) q = q.cursor(cursor);
    const { records } = (await q.call()) as unknown as { records: RegistroTx[] };
    const achou = records.find((r) => r.hash === hash);
    if (achou) return achou;
    vistos += records.length;
    if (records.length < PAGINA_HORIZON || vistos >= esperado) break;
    cursor = records[records.length - 1].paging_token;
  }
  if (vistos !== esperado) {
    throw indeterminado(`ledger ${l.sequence} veio com ${vistos} de ${esperado} txs`);
  }
  return null;
}

/**
 * Decide, pelo ledger do Horizon e não pelo relógio local, se a tx do
 * envelope ainda pode entrar:
 * - ENTROU: está no ledger (achada pelo hash ou na varredura da janela);
 * - EM_ABERTO: a rede ainda não fechou ledger com closeTime > maxTime;
 * - EXPIROU: já fechou, e a tx não está em nenhum ledger da janela em que
 *   podia entrar (cada ledger conferido contra a própria contagem de txs).
 * Qualquer erro (404 de ledger da janela, lista incompleta, Horizon fora)
 * PROPAGA: significa indeterminado — não reemitir.
 * Só EXPIROU autoriza tx nova; ela sai da mesma conta-fonte (issuer).
 */
export async function txExpirouNaRede(xdr: string): Promise<ExpiracaoNaRede> {
  return (await avaliarExpiracao(xdr)).r;
}

async function avaliarExpiracao(
  xdr: string,
): Promise<{ r: ExpiracaoNaRede; registro?: RegistroTx }> {
  const tx = new Transaction(xdr, networkPassphrase);
  const hash = tx.hash().toString('hex');
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (!maxTime) throw indeterminado('envelope sem maxTime');

  const direto = await buscarRegistroTx(hash);
  if (direto) {
    return {
      r: { status: 'ENTROU', hash, successful: direto.successful, ledger: direto.ledger_attr ?? 0 },
      registro: direto,
    };
  }

  const pagina = (await horizon.ledgers().order('desc').limit(1).call()) as unknown as {
    records: RegistroLedger[];
  };
  const ultimo = pagina.records[0];
  if (!ultimo) throw indeterminado('Horizon sem ledgers');
  if (fechouEm(ultimo) <= maxTime) return { r: { status: 'EM_ABERTO', hash, maxTime } };

  const aposPrazo = await primeiroLedgerAposPrazo(ultimo, maxTime);
  const limiteInferior = maxTime - STELLAR_TX_TIMEOUT_SEC - FOLGA_RELOGIO_SEC;
  let esperado = aposPrazo.sequence - 1;
  let cursor = aposPrazo.paging_token;
  let varridos = 0;
  for (;;) {
    const { records } = (await horizon
      .ledgers()
      .cursor(cursor)
      .order('desc')
      .limit(PAGINA_HORIZON)
      .call()) as unknown as { records: RegistroLedger[] };
    if (records.length === 0) throw indeterminado('histórico do Horizon não cobre a janela');
    for (const l of records) {
      if (l.sequence !== esperado) throw indeterminado(`ledger ${esperado} faltando na listagem`);
      if (fechouEm(l) < limiteInferior) {
        return {
          r: {
            status: 'EXPIROU',
            hash,
            maxTime,
            ledgerAposPrazo: aposPrazo.sequence,
            fechadoEm: aposPrazo.closed_at,
          },
        };
      }
      if (++varridos > MAX_LEDGERS_JANELA) throw indeterminado('janela maior que o limite');
      const achou = await txNoLedger(l, hash);
      if (achou) {
        return {
          r: { status: 'ENTROU', hash, successful: achou.successful, ledger: l.sequence },
          registro: achou,
        };
      }
      esperado -= 1;
    }
    cursor = records[records.length - 1].paging_token;
  }
}

/**
 * Submete um envelope já assinado e classifica o resultado:
 * - SUCCESS: entrou;
 * - FAILED: o Horizon devolveu `result_codes` (definitivo: não entrou);
 * - AMBIGUOUS: timeout, 5xx, 429, rede ou 400 sem códigos — pode ter entrado.
 * `tx_bad_seq` é conferido pelo hash: a própria tx pode ter acabado de entrar
 * (reenvio); se não aparece, fica AMBIGUOUS até o prazo.
 */
export async function submitEnvelope(
  xdr: string,
  opts?: { substitui?: string },
): Promise<EnvelopeResult> {
  const r = await submeterEClassificar(xdr);
  if (opts?.substitui && r.status === 'AMBIGUOUS' && r.reason === 'tx_bad_seq') {
    return desfechoDaSequenciaConsumida(opts.substitui);
  }
  return r;
}

export type ConsumoDaSequencia =
  | { status: 'ANTIGA_ENTROU'; hash: string; successful: boolean; ledger: number }
  | { status: 'OUTRA_TX'; hash: string }
  | { status: 'INDETERMINADO'; motivo: string };

type RegistroTxDaConta = RegistroTx & { source_account: string; source_account_sequence: string };

/**
 * Prova POSITIVA de qual tx consumiu a sequence S das tentativas (todas com a
 * mesma conta-fonte e a mesma S): lê 1 página das txs da conta do issuer e
 * procura `source_account_sequence === S`. Um 404 por hash nunca é prova:
 * se S não aparece, INDETERMINADO. Erro do Horizon propaga.
 * Uso depois de EMISSAO_SEQUENCIA_CONSUMIDA
 * (contratos/2026-11-10-substituicao-mesma-sequence.md, adendo).
 */
export async function quemConsumiuSequence(xdrs: string[]): Promise<ConsumoDaSequencia> {
  if (xdrs.length === 0) throw new Error('quemConsumiuSequence: nenhuma tentativa informada.');
  const txs = xdrs.map((x) => new Transaction(x, networkPassphrase));
  const fonte = txs[0].source;
  const seq = txs[0].sequence;
  if (txs.some((t) => t.source !== fonte || t.sequence !== seq)) {
    throw new Error('quemConsumiuSequence: tentativas com conta-fonte ou sequence diferentes.');
  }
  const nossas = new Set(txs.map((t) => t.hash().toString('hex')));

  const { records } = (await horizon
    .transactions()
    .forAccount(fonte)
    .order('desc')
    .includeFailed(true)
    .limit(PAGINA_HORIZON)
    .call()) as unknown as { records: RegistroTxDaConta[] };
  const consumidora = records.find(
    (r) => r.source_account === fonte && r.source_account_sequence === seq,
  );
  if (!consumidora) {
    return { status: 'INDETERMINADO', motivo: `sequence ${seq} não aparece na página da conta` };
  }
  if (nossas.has(consumidora.hash)) {
    return {
      status: 'ANTIGA_ENTROU',
      hash: consumidora.hash,
      successful: consumidora.successful,
      ledger: consumidora.ledger_attr ?? 0,
    };
  }
  return { status: 'OUTRA_TX', hash: consumidora.hash };
}

/**
 * Substituição voltou tx_bad_seq: a sequence foi consumida. Se foi a tentativa
 * anterior que emitiu, o desfecho é o dela; senão, erro definitivo (falha fechado).
 */
async function desfechoDaSequenciaConsumida(xdrAnterior: string): Promise<EnvelopeResult> {
  const hashAnterior = new Transaction(xdrAnterior, networkPassphrase).hash().toString('hex');
  const r = await buscarRegistroTx(hashAnterior);
  if (r?.successful) return { status: 'SUCCESS', hash: hashAnterior, response: respostaDoRegistro(r) };
  throw new EmissaoError('EMISSAO_SEQUENCIA_CONSUMIDA', hashAnterior);
}

async function submeterEClassificar(xdr: string): Promise<EnvelopeResult> {
  const tx = new Transaction(xdr, networkPassphrase);
  const hash = tx.hash().toString('hex');
  try {
    const response = await withSpan(
      'stellar.submit',
      { 'stellar.flow': 'issuer', 'stellar.network': STELLAR_NETWORK },
      async (span) => {
        const res = await horizon.submitTransaction(tx);
        span.setAttribute('stellar.tx_hash', res.hash);
        return res;
      },
    );
    return { status: 'SUCCESS', hash, response };
  } catch (err) {
    const codes = resultCodesDe(err);
    if (statusHttpDe(err) === 400 && codes) {
      if (codes.transaction === 'tx_bad_seq') {
        const r = await buscarRegistroTx(hash);
        if (r?.successful) return { status: 'SUCCESS', hash, response: respostaDoRegistro(r) };
        if (r) return { status: 'FAILED', hash, resultCodes: { transaction: 'tx_failed' } };
        return { status: 'AMBIGUOUS', hash, reason: 'tx_bad_seq' };
      }
      return { status: 'FAILED', hash, resultCodes: codes };
    }
    const http = statusHttpDe(err);
    const e = err as ErroHorizon;
    return {
      status: 'AMBIGUOUS',
      hash,
      reason: http ? `http_${http}` : (e?.code ?? e?.name ?? 'rede'),
    };
  }
}

type Relogio = { agora: () => number; dormir: (ms: number) => Promise<void> };
const RELOGIO_REAL: Relogio = {
  agora: () => Date.now(),
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
};
let relogio: Relogio = RELOGIO_REAL;

/** Só para testes: injeta o relógio (sem argumento, volta ao real). */
export function _setRelogioForTests(r?: Partial<Relogio>): void {
  relogio = { ...RELOGIO_REAL, ...r };
}

const INTERVALO_REENVIO_MS = 5_000;
const FOLGA_PRAZO_SEC = 10;
/** Depois do prazo, quanto esperar a rede fechar um ledger > maxTime antes de desistir sem desfecho. */
const ESPERA_REDE_SEC = 60;

/**
 * Leva a emissão a um desfecho conclusivo. No erro ambíguo reenvia o MESMO
 * envelope (mesmo hash e sequence: a rede não aplica duas vezes) e consulta
 * por hash até `maxTime` + 10 s. Bloqueia até ~130 s nesse caso; quem não
 * pode esperar usa as primitivas e persiste a tentativa (contrato 10:37).
 */
async function confirmarEmissao(
  env: { xdr: string; hash: string; maxTime: number },
  substitui?: string,
): Promise<SubmitResult> {
  const subOpts = substitui ? { substitui } : undefined;
  const primeiro = await submitEnvelope(env.xdr, subOpts);
  if (primeiro.status === 'SUCCESS') return primeiro.response;
  if (primeiro.status === 'FAILED') {
    throw new EmissaoError('EMISSAO_FALHOU', env.hash, { resultCodes: primeiro.resultCodes });
  }

  const prazoMs = (env.maxTime + FOLGA_PRAZO_SEC) * 1000;
  while (relogio.agora() < prazoMs) {
    await relogio.dormir(INTERVALO_REENVIO_MS);
    let r: RegistroTx | null = null;
    try {
      r = await buscarRegistroTx(env.hash);
    } catch {
      continue; // Horizon instável no meio da espera: a consulta final decide.
    }
    if (r?.successful) return respostaDoRegistro(r);
    if (r) throw new EmissaoError('EMISSAO_FALHOU', env.hash, { resultCodes: { transaction: 'tx_failed' } });
    if (relogio.agora() < env.maxTime * 1000) {
      const reenvio = await submitEnvelope(env.xdr, subOpts);
      if (reenvio.status === 'SUCCESS') return reenvio.response;
      const codigo = (reenvio as { resultCodes?: { transaction?: string } }).resultCodes?.transaction;
      if (reenvio.status === 'FAILED' && codigo !== 'tx_too_late') {
        throw new EmissaoError('EMISSAO_FALHOU', env.hash, { resultCodes: reenvio.resultCodes });
      }
    }
  }

  // Desfecho decidido pela rede (R1): erro aqui propaga (não afirma "não entrou").
  const limiteEspera = (env.maxTime + FOLGA_PRAZO_SEC + ESPERA_REDE_SEC) * 1000;
  for (;;) {
    const { r, registro } = await avaliarExpiracao(env.xdr);
    if (r.status === 'EXPIROU') {
      throw new EmissaoError('EMISSAO_NAO_CONFIRMADA', env.hash, { maxTime: env.maxTime });
    }
    if (r.status === 'ENTROU') {
      if (!r.successful) {
        throw new EmissaoError('EMISSAO_FALHOU', env.hash, { resultCodes: { transaction: 'tx_failed' } });
      }
      return respostaDoRegistro({ ...registro!, ledger_attr: registro!.ledger_attr ?? r.ledger });
    }
    if (relogio.agora() >= limiteEspera) {
      throw new Error(
        `Emissão ${env.hash}: expiração indeterminada — a rede não fechou ledger depois do maxTime. Não reemitir; consultar de novo.`,
      );
    }
    await relogio.dormir(INTERVALO_REENVIO_MS);
  }
}

export type EmissaoPorMemoErrorCode =
  | 'CONFIG_AUSENTE'
  | 'EMISSAO_DUPLICADA'
  | 'HISTORICO_EXCEDE_LIMITE';

const MENSAGENS_BUSCA: Record<EmissaoPorMemoErrorCode, string> = {
  CONFIG_AUSENTE: 'Busca de emissão indisponível: configuração do ledger incompleta.',
  EMISSAO_DUPLICADA:
    'Mais de uma emissão com o mesmo memo: operador precisa reconciliar antes de seguir.',
  HISTORICO_EXCEDE_LIMITE:
    'Histórico da conta excede o limite de busca: não é possível afirmar que não houve emissão.',
};

/** Erro da busca de emissão por memo. Nunca vira `null`: o caller não reemite. */
export class EmissaoPorMemoError extends Error {
  readonly code: EmissaoPorMemoErrorCode;

  constructor(code: EmissaoPorMemoErrorCode) {
    super(MENSAGENS_BUSCA[code]);
    this.name = 'EmissaoPorMemoError';
    this.code = code;
  }
}

const BUSCA_PAGINA = 200;
const BUSCA_MAX_PAGINAS = 50;

type TxRecordMin = { hash: string; successful: boolean; memo_type: string; memo?: string };
type PaginaTx = { records: TxRecordMin[]; next(): Promise<PaginaTx> };
type OpRecordMin = {
  type: string;
  from?: string;
  to?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
};

/**
 * Procura no Horizon a emissão do issuer para `destination` no asset `code`
 * com `Memo.hash` = `memoHash`. Devolve `{ txHash, amount }`, ou `null` só
 * quando o histórico inteiro foi lido e nada bate.
 *
 * Varre as tx bem-sucedidas da conta de destino, filtra pelo memo e confere
 * nas operações um payment do issuer para o destino naquele asset — qualquer
 * um pode mandar uma tx com o mesmo memo, mas só o issuer emite.
 *
 * Fail-closed: erro do Horizon propaga; histórico acima do limite ou mais de
 * uma emissão com o mesmo memo lançam `EmissaoPorMemoError`.
 */
export async function buscarEmissaoPorMemo(input: {
  code: string;
  destination: string;
  memoHash: Buffer;
}): Promise<{ txHash: string; amount: string } | null> {
  assertCodeDaPlina(input.code);
  assertMemoHash(input.memoHash);
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  if (!issuerPubkey) throw new EmissaoPorMemoError('CONFIG_AUSENTE');
  const memoB64 = input.memoHash.toString('base64');

  const candidatas: string[] = [];
  let pagina = (await horizon
    .transactions()
    .forAccount(input.destination)
    .order('desc')
    .limit(BUSCA_PAGINA)
    .call()) as unknown as PaginaTx;
  for (let n = 1; pagina.records.length > 0; n++) {
    if (n > BUSCA_MAX_PAGINAS) throw new EmissaoPorMemoError('HISTORICO_EXCEDE_LIMITE');
    for (const tx of pagina.records) {
      if (tx.successful && tx.memo_type === 'hash' && tx.memo === memoB64) {
        candidatas.push(tx.hash);
      }
    }
    // Segue até a página vazia, mesmo se esta veio incompleta: parar cedo
    // devolveria null e faria o caller reemitir.
    pagina = await pagina.next();
  }

  const achadas: Array<{ txHash: string; amount: string }> = [];
  for (const txHash of candidatas) {
    const ops = (await horizon
      .operations()
      .forTransaction(txHash)
      .limit(BUSCA_PAGINA)
      .call()) as unknown as { records: OpRecordMin[] };
    const emissoes = ops.records.filter(
      (op) =>
        op.type === 'payment' &&
        op.from === issuerPubkey &&
        op.to === input.destination &&
        op.asset_code === input.code &&
        op.asset_issuer === issuerPubkey,
    );
    if (emissoes.length === 0) continue;
    const total = emissoes.reduce(
      (acc, op) => acc.plus(new Prisma.Decimal(op.amount ?? '0')),
      new Prisma.Decimal(0),
    );
    achadas.push({ txHash, amount: total.toFixed(7) });
  }

  if (achadas.length > 1) throw new EmissaoPorMemoError('EMISSAO_DUPLICADA');
  return achadas[0] ?? null;
}

export async function distribute(
  distributor: StellarSigner,
  issuerPubkey: string,
  destinationPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(distributor, {
    xlm: DISTRIBUTOR_BALANCE_FLOOR,
    label: 'distributor',
  });
  builder.addOperation(
    Operation.payment({
      destination: destinationPubkey,
      asset: buildAsset(issuerPubkey, code),
      amount,
    }),
  );
  return sign(builder, [source]);
}

/**
 * Executa clawback. Whitepaper §6.5: 4 hipóteses exclusivas.
 * O caller é responsável por persistir motivo + fundamento em EventoAudit
 * ANTES de chamar.
 */
export async function executeClawback(
  issuer: StellarSigner,
  fromPubkey: string,
  amount: string,
  code: string = assetCode,
): Promise<SubmitResult> {
  const { source, builder } = await buildSourceTx(issuer);
  builder.addOperation(
    Operation.clawback({
      asset: buildAsset(source.publicKey(), code),
      from: fromPubkey,
      amount,
    }),
  );
  return sign(builder, [source]);
}
