/**
 * Denominador do "PLINA-RF emitido" e da participação em /minha-posicao: o supply do LEDGER
 * (`supply.totalEmitido` = circulante + tesouraria), o mesmo do /pool e do NAV por token.
 * `tokensVivos` (soma dos tokens das cotas no banco) não serve: não muda com swap de investidor.
 * Só EXIBIÇÃO: o servidor calcula o supply; aqui só se lê e se divide.
 */
export interface PoolComSupply {
  tokensVivos: number;
  supply?: { totalEmitido: string } | null;
}

export function emitidoNoLedger(pool: PoolComSupply | null | undefined): number | null {
  const bruto = pool?.supply?.totalEmitido;
  if (bruto === undefined || bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

export function participacaoPct(qty: number, pool: PoolComSupply | null | undefined): number {
  const emitido = emitidoNoLedger(pool);
  return emitido !== null && emitido > 0 ? (qty / emitido) * 100 : 0;
}
