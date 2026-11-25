/**
 * Links do explorer (stellar.expert) conscientes da rede.
 *
 * Fica fora de `config.ts` de propósito: `config.ts` importa o `@stellar/stellar-sdk`
 * e lê `STELLAR_NETWORK` (sem NEXT_PUBLIC), então um componente cliente que o
 * importasse puxaria o SDK para o bundle e sempre enxergaria TESTNET. Aqui não há
 * dependência pesada e a rede vem de `NEXT_PUBLIC_STELLAR_NETWORK`, que o
 * `next.config.ts` preenche a partir de `STELLAR_NETWORK` (uma só fonte de verdade
 * para servidor e cliente). Qualquer valor diferente de `PUBLIC` cai em testnet,
 * igual à passphrase em `config.ts`.
 */

const BASE_PUBLIC = 'https://stellar.expert/explorer/public';
const BASE_TESTNET = 'https://stellar.expert/explorer/testnet';

function explorerBase(): string {
  const rede = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? process.env.STELLAR_NETWORK;
  return rede === 'PUBLIC' ? BASE_PUBLIC : BASE_TESTNET;
}

export const txExplorerUrl = (hash: string) => `${explorerBase()}/tx/${hash}`;
export const accountExplorerUrl = (pubkey: string) => `${explorerBase()}/account/${pubkey}`;
export const assetExplorerUrl = (issuerPubkey: string, code = 'PLINARF') =>
  `${explorerBase()}/asset/${code}-${issuerPubkey}`;
