/**
 * On-chain audit hash layer.
 *
 * Whitepaper §6.1 + §9: "hash do documento de validação na Stellar como
 * prova pública" / "on-chain apenas hash, endereços e timestamps".
 *
 * Vendedor e comprador-usuário NÃO têm wallet Stellar. A Plina assina, em
 * nome do ato, uma transação self-payment de 0.0000001 XLM com `Memo.hash`
 * carregando o SHA-256 do payload. Qualquer parte pode cross-verificar:
 * SHA-256 do documento off-chain deve bater com o memo on-chain.
 *
 * Por que self-payment + MemoHash (e não manageData):
 *   - manageData adiciona reserve cost por entry (0.5 XLM cada). Acumula
 *     em pool com volume.
 *   - Memo é gratuito, 32 bytes exatos pra SHA-256.
 *   - Stellar Expert mostra Memo na UI da tx; vendor consegue ler.
 *
 * Determinismo: payload sempre passa por `stableSerialize` (chaves sorted)
 * antes do hash. Mesmo payload → mesma fingerprint, sempre.
 */

import { createHash } from 'node:crypto';
import {
  Asset,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { horizon } from './account';
import { STELLAR_TX_TIMEOUT_SEC, networkPassphrase } from './config';
import { getDynamicFee } from './fee';

/**
 * Serialização canônica JSON com chaves sorted recursivamente. Garante que
 * o hash seja idêntico independente da ordem de inserção dos campos.
 */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableSerialize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableSerialize(obj[k]))
      .join(',') +
    '}'
  );
}

/** SHA-256 hex (64 chars) do payload canonicalizado. */
export function sha256OfPayload(payload: unknown): string {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

export interface AuditPayloadBase {
  /**
   * Tipo do evento, sempre embutido no hash. Permite filtragem de eventos
   * por categoria sem dependência de armazenamento off-chain.
   */
  _type: string;
  /** ISO timestamp. Permite que duas execuções idênticas gerem hashes distintos. */
  _at: string;
  /** Identificador da entidade primária (cota_id, lead_id, cessao_id). */
  _ref?: string;
}

/**
 * Constrói payload com campos canônicos (_type, _at, _ref) prepended a
 * payload de domínio. Garante que toda prova on-chain seja categorizável e
 * temporalmente única.
 */
export function buildAuditPayload<T extends Record<string, unknown>>(
  type: string,
  ref: string | undefined,
  domain: T,
): AuditPayloadBase & T {
  return {
    _type: type,
    _at: new Date().toISOString(),
    _ref: ref,
    ...domain,
  };
}

export interface RegisterOnChainHashResult {
  payloadHash: string;
  txHash: string;
}

/**
 * Submete tx Stellar com Memo.hash carregando SHA-256 do payload. Source
 * account é o issuer (STELLAR_ISSUER_SECRET). Custo total: ~0.00001 XLM
 * (fee), 0.0000001 XLM (self-payment), efetivamente gratuito.
 *
 * Retorna `{payloadHash, txHash}` pra persistir em EventoAudit. Vendor/
 * comprador-usuário recebe `txHash` pra verificar no Stellar Expert e
 * cross-conferir com SHA-256 do documento em mãos.
 */
export async function registerOnChainHash(
  payload: AuditPayloadBase,
): Promise<RegisterOnChainHashResult> {
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('STELLAR_ISSUER_SECRET ausente.');
  }

  const source = Keypair.fromSecret(issuerSecret);
  const account = await horizon.loadAccount(source.publicKey());
  const payloadHash = sha256OfPayload(payload);

  // Memo.hash exige Buffer de 32 bytes exatos. SHA-256 hex (64 chars) = 32 bytes.
  const memoBuffer = Buffer.from(payloadHash, 'hex');
  if (memoBuffer.length !== 32) {
    throw new Error(`Memo hash inválido: esperado 32 bytes, recebido ${memoBuffer.length}`);
  }

  const tx = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount: '0.0000001',
      }),
    )
    .addMemo(Memo.hash(memoBuffer))
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();

  tx.sign(source);
  const result = await horizon.submitTransaction(tx);
  return { payloadHash, txHash: result.hash };
}
