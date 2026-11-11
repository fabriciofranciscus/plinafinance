/**
 * Porta de âncora de SHA-256 em memo (contrato `contratos/2026-11-11-ancora-sha256.md`).
 *
 * A implementação real é da Estela (`lib/stellar/anchor.ts`). Até ela publicar,
 * esta porta FALHA FECHADO: o fluxo do DS3 guarda o PDF e o hash, mas não marca a
 * cessão como ASSINADA sem a âncora. Trocar o corpo destas duas funções pelos
 * imports de `lib/stellar/anchor` quando o commit existir.
 */

export class AncoraIndisponivelError extends Error {
  readonly code = 'ANCORA_INDISPONIVEL' as const;
  constructor() {
    super('Âncora on-chain do hash ainda não disponível.');
    this.name = 'AncoraIndisponivelError';
  }
}

export async function buscarAncora(_sha256Hex: string): Promise<{ txHash: string } | null> {
  throw new AncoraIndisponivelError();
}

export async function ancorar(_sha256Hex: string): Promise<{ txHash: string }> {
  throw new AncoraIndisponivelError();
}
