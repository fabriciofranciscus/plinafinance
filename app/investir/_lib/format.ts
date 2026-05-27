export const NUMBER_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
export const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

export function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
export function explorerAccount(pubkey: string) {
  return `https://stellar.expert/explorer/testnet/account/${pubkey}`;
}
export function maskId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length < 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
export function maskPubkey(pk: string | null | undefined): string {
  if (!pk) return '—';
  if (pk.length < 16) return pk;
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`;
}
