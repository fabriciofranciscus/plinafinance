import {
  AuthClawbackEnabledFlag,
  type AuthFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  Memo,
  Operation,
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
  | 'ISSUE_MEMO_INVALID';

const MENSAGENS_ISSUE: Record<IssueAssetErrorCode, string> = {
  ISSUE_CODE_UNKNOWN: 'Emissão recusada: asset code ausente ou fora da Plina.',
  ISSUE_AMOUNT_INVALID: 'Emissão recusada: amount precisa ser string > 0 com até 7 casas.',
  ISSUE_MEMO_INVALID: 'Emissão recusada: memoHash precisa ter exatamente 32 bytes.',
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
  opts?: { memoHash?: Buffer },
): Promise<SubmitResult> {
  assertIssueInput(amount, code);
  if (opts && 'memoHash' in opts) assertMemoHash(opts.memoHash);
  const { source, builder } = await buildSourceTx(issuer, {
    xlm: ISSUER_BALANCE_FLOOR,
    label: 'issuer',
  });
  builder.addOperation(
    Operation.payment({
      destination: destinationPubkey,
      asset: buildAsset(source.publicKey(), code),
      amount,
    }),
  );
  if (opts?.memoHash) builder.addMemo(Memo.hash(opts.memoHash));
  return sign(builder, [source]);
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
