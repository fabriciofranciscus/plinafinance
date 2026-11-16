import { describe, expect, it } from 'vitest';
import { emitidoNoLedger, participacaoPct } from '../_lib/emitido-ledger';

// O /pool e o NAV por token dividem pelo supply do LEDGER (circulante + tesouraria = supply.totalEmitido).
// `tokensVivos` é a soma dos tokens das cotas no banco: não se move com entrada/saída de investidor.
const pool = { tokensVivos: 418600, supply: { totalEmitido: '418650.5' } };

describe('/minha-posicao: denominador do emitido e da participação', () => {
  it('o "emitido" é o supply do ledger, não tokensVivos', () => {
    expect(emitidoNoLedger(pool)).toBe(418650.5);
  });

  it('sem supply do ledger não cai em tokensVivos: devolve null', () => {
    expect(emitidoNoLedger({ tokensVivos: 418600 })).toBeNull();
    expect(emitidoNoLedger({ tokensVivos: 418600, supply: null })).toBeNull();
    expect(emitidoNoLedger(null)).toBeNull();
  });

  it('a participação divide pelo supply do ledger', () => {
    expect(participacaoPct(418.6505, pool)).toBeCloseTo(0.1, 10);
    // com tokensVivos como denominador daria outro número
    expect(participacaoPct(418.6505, pool)).not.toBeCloseTo((418.6505 / 418600) * 100, 6);
  });

  it('participação 0 quando não há supply, supply 0 ou valor inválido', () => {
    expect(participacaoPct(10, { tokensVivos: 5 })).toBe(0);
    expect(participacaoPct(10, { tokensVivos: 5, supply: { totalEmitido: '0' } })).toBe(0);
    expect(participacaoPct(10, { tokensVivos: 5, supply: { totalEmitido: 'abc' } })).toBe(0);
    expect(emitidoNoLedger({ tokensVivos: 5, supply: { totalEmitido: 'abc' } })).toBeNull();
  });
});
