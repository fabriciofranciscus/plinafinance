/**
 * N1-at — a emissão só sai para trustline JÁ autorizada pelo issuer.
 *
 * O issuer tem AUTH_REQUIRED + AUTH_REVOCABLE: uma trustline nasce
 * desautorizada e pode ser revogada depois. Se a perna de emissão for para
 * uma trustline sem autorização, a rede recusa com `op_not_authorized` — a
 * fee é gasta e o investidor vê um erro opaco. Aqui recusamos ANTES de
 * submeter, com erro tipado. `authorized_to_maintain_liabilities` não basta:
 * nesse estado a conta mantém o saldo, mas não pode receber.
 *
 * Contrato: contratos/2026-11-11-n1-at-trustline-autorizada.md.
 */
import { Transaction } from '@stellar/stellar-sdk';
import { horizon } from './account';

export type TrustlineErrorCode = 'TRUSTLINE_AUSENTE' | 'TRUSTLINE_NAO_AUTORIZADA';

const MENSAGENS: Record<TrustlineErrorCode, string> = {
  TRUSTLINE_AUSENTE: 'Emissão recusada: a carteira não tem trustline para o token.',
  TRUSTLINE_NAO_AUTORIZADA:
    'Emissão recusada: a trustline da carteira ainda não foi autorizada pelo emissor.',
};

export class TrustlineNaoAutorizadaError extends Error {
  readonly code: TrustlineErrorCode;
  readonly holder: string;
  /** `CODE:ISSUER`. */
  readonly asset: string;

  constructor(code: TrustlineErrorCode, holder: string, asset: string) {
    super(MENSAGENS[code]);
    this.name = 'TrustlineNaoAutorizadaError';
    this.code = code;
    this.holder = holder;
    this.asset = asset;
  }
}

type BalanceLine = {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
};

/**
 * Exige trustline `code:issuer` com `is_authorized === true` nas balances da
 * conta. Puro: não vai à rede. Balances ausentes contam como sem trustline
 * (fail-closed).
 */
export function exigirTrustlineAutorizada(
  balances: ReadonlyArray<BalanceLine> | undefined,
  code: string,
  issuerPubkey: string,
  holderPubkey = '',
): void {
  const asset = `${code}:${issuerPubkey}`;
  const linha = (balances ?? []).find(
    (b) => b.asset_code === code && b.asset_issuer === issuerPubkey,
  );
  if (!linha) throw new TrustlineNaoAutorizadaError('TRUSTLINE_AUSENTE', holderPubkey, asset);
  if (linha.is_authorized !== true) {
    throw new TrustlineNaoAutorizadaError('TRUSTLINE_NAO_AUTORIZADA', holderPubkey, asset);
  }
}

/** Carrega a conta no Horizon e exige a trustline autorizada. Erro de rede propaga. */
export async function assertTrustlineAutorizada(input: {
  holderPubkey: string;
  code: string;
  issuerPubkey: string;
}): Promise<void> {
  const conta = await horizon.loadAccount(input.holderPubkey);
  exigirTrustlineAutorizada(
    (conta as unknown as { balances?: BalanceLine[] }).balances,
    input.code,
    input.issuerPubkey,
    input.holderPubkey,
  );
}

/**
 * Pernas de emissão de uma tx: payments de asset emitido cujo source é o
 * próprio issuer desse asset (cunhagem). Destino = o próprio issuer é queima
 * e fica de fora.
 */
export function pernasDeEmissao(
  tx: Transaction,
): Array<{ destination: string; code: string; issuer: string }> {
  const pernas: Array<{ destination: string; code: string; issuer: string }> = [];
  for (const op of tx.operations) {
    if (op.type !== 'payment' || op.asset.isNative()) continue;
    const source = op.source ?? tx.source;
    const issuer = op.asset.getIssuer();
    if (source !== issuer || op.destination === issuer) continue;
    pernas.push({ destination: op.destination, code: op.asset.getCode(), issuer });
  }
  return pernas;
}

/** Exige trustline autorizada em todo destino de emissão da tx. */
export async function exigirEmissoesParaTrustlineAutorizada(tx: Transaction): Promise<void> {
  for (const perna of pernasDeEmissao(tx)) {
    await assertTrustlineAutorizada({
      holderPubkey: perna.destination,
      code: perna.code,
      issuerPubkey: perna.issuer,
    });
  }
}
