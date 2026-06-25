/**
 * Configuração e gates do anchor Etherfuse.
 *
 * `ETHERFUSE_ENV` era lido solto em cada rota (`?? 'sandbox'`, fail-open).
 * O perigo: o fallback **mock** de bank-account (PLINA-MOD-005/006) emite
 * PLINARF SEM perna TESOURO (mint grátis) e era gateado só nessa env — num
 * deploy mainnet com `ETHERFUSE_ENV` esquecido, o default `'sandbox'` reabria
 * o mock. Aqui o gate passa a derivar da REDE (`STELLAR_NETWORK`), fonte de
 * verdade fail-closed: PUBLIC nunca mocka.
 */

import { STELLAR_NETWORK } from '../stellar/config';

export type EtherfuseEnv = 'sandbox' | 'production';

export function etherfuseEnv(): string {
  return process.env.ETHERFUSE_ENV ?? 'sandbox';
}

/**
 * Mock de bank-account (PLINA-MOD-005/006) emite PLINARF sem perna TESOURO —
 * só pode existir fora de mainnet. Fail-CLOSED na rede: PUBLIC nunca mocka,
 * mesmo com ETHERFUSE_ENV ausente/errado (default fail-open 'sandbox').
 * STELLAR_NETWORK é a fonte de verdade.
 */
export function sandboxMockAllowed(): boolean {
  return STELLAR_NETWORK !== 'PUBLIC' && etherfuseEnv() === 'sandbox';
}

/**
 * Consistência das envs no boot. Lança se a combinação é insegura/inválida,
 * pra estourar o deploy em vez de cair no mock silenciosamente.
 */
export function assertEtherfuseEnvConsistency(): void {
  if (!['TESTNET', 'PUBLIC'].includes(STELLAR_NETWORK)) {
    throw new Error(`[env] STELLAR_NETWORK inválido: ${STELLAR_NETWORK}`);
  }
  if (!['sandbox', 'production'].includes(etherfuseEnv())) {
    throw new Error(`[env] ETHERFUSE_ENV inválido: ${etherfuseEnv()}`);
  }
  if (STELLAR_NETWORK === 'PUBLIC' && etherfuseEnv() !== 'production') {
    throw new Error(
      `[env] STELLAR_NETWORK=PUBLIC exige ETHERFUSE_ENV=production ` +
        `(recebido: ${process.env.ETHERFUSE_ENV ?? 'ausente'}). ` +
        `Mock de bank-account emitiria PLINARF sem perna TESOURO.`,
    );
  }
}
