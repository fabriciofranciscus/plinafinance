# Fireblocks — custódia issuer/distributor (M0, P0 mainnet)

Ver `docs/PRD-plina-v1.md` §M0 (F-M0-1).

Substitui `Keypair.fromSecret(process.env.ISSUER_SECRET)` em
`lib/stellar/transactions.ts` por signing via Fireblocks SDK (`RAW` signing
type para Stellar Ed25519, ou via Fireblocks Stellar template).

Interface mínima:

```ts
export interface StellarSigner {
  publicKey(): string;
  signEnvelope(envelopeXdr: string, networkPassphrase: string): Promise<string>;
}

export function fireblocksIssuer(): StellarSigner;
export function fireblocksDistributor(): StellarSigner;
```

Em testnet (`STELLAR_NETWORK=TESTNET`) cair pra `KeypairSigner` que usa
`process.env.ISSUER_SECRET` direto (compat com setup atual). Em mainnet
exigir Fireblocks; assert no startup.

Bloqueado por: conta Fireblocks + KYB (trilha A do PRD).
