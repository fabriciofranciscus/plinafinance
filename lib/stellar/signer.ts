/**
 * Port de assinatura Stellar (PRD §M0, F-M0-1).
 *
 * Centraliza a assinatura das chaves operacionais (issuer/distributor) num
 * único seam. Em testnet usa `KeypairSigner` (secret em env, igual ao POC).
 * Em mainnet (`STELLAR_NETWORK=PUBLIC`) recusa assinar com secret em env e
 * exige custódia Fireblocks — o `FireblocksSigner` concreto entra na Fase 2
 * (ver `lib/integrations/fireblocks/README.md`).
 *
 * O funder (F-08) NÃO passa por aqui: por decisão de arquitetura ele continua
 * assinando com secret em env mesmo em mainnet (não está sob Fireblocks).
 */

import { Keypair, Transaction } from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from './config';

export interface StellarSigner {
  publicKey(): string;
  /** Anexa a signature à tx in-place (DecoratedSignature). */
  sign(tx: Transaction): void;
  /** Signature base64 crua — pra `tx.addSignature` / `extraSignatures`. */
  signatureBase64(tx: Transaction): string;
}

/**
 * Signer baseado em secret seed. Lazy: só materializa o `Keypair` no primeiro
 * uso (publicKey/sign) — assim construir o signer não falha com seeds inválidos
 * em caminhos onde a assinatura real é mockada (testes unit).
 */
export class KeypairSigner implements StellarSigner {
  private readonly secret: string;
  private cached?: Keypair;

  constructor(secret: string) {
    this.secret = secret;
  }

  private kp(): Keypair {
    if (!this.cached) this.cached = Keypair.fromSecret(this.secret);
    return this.cached;
  }

  publicKey(): string {
    return this.kp().publicKey();
  }

  sign(tx: Transaction): void {
    tx.sign(this.kp());
  }

  signatureBase64(tx: Transaction): string {
    return this.kp().sign(tx.hash()).toString('base64');
  }
}

function custodyConfigured(): boolean {
  return Boolean(
    process.env.FIREBLOCKS_API_KEY && process.env.FIREBLOCKS_API_SECRET,
  );
}

/**
 * Resolve o signer de uma chave operacional (issuer/distributor). Em mainnet
 * exige Fireblocks e NUNCA cai pra secret em env — fail-closed até a Fase 2.
 */
function operationalSigner(
  envSecret: string | undefined,
  role: 'issuer' | 'distributor',
): StellarSigner {
  if (STELLAR_NETWORK === 'PUBLIC') {
    if (!custodyConfigured()) {
      throw new Error(
        `${role}: custódia Fireblocks obrigatória em mainnet (F-M0-1) — ` +
          'STELLAR_NETWORK=PUBLIC sem FIREBLOCKS_*; recuso assinar com secret em env.',
      );
    }
    // TODO Fase 2 (F-M0-1): return new FireblocksSigner(role).
    throw new Error(
      `${role}: FireblocksSigner ainda não implementado (F-M0-1, Fase 2).`,
    );
  }
  if (!envSecret) {
    throw new Error(`${role}: secret ausente (env não configurado).`);
  }
  return new KeypairSigner(envSecret);
}

export function issuerSigner(): StellarSigner {
  return operationalSigner(process.env.STELLAR_ISSUER_SECRET, 'issuer');
}

export function distributorSigner(): StellarSigner {
  return operationalSigner(process.env.STELLAR_DISTRIBUTOR_SECRET, 'distributor');
}
