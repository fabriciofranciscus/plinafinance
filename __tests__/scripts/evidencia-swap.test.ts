import { describe, it, expect } from 'vitest';
import { classificarSwap, type OpLida, type ResultadoSwap } from '../../scripts/evidencia-swap/core';

const motivo = (r: ResultadoSwap) => ('motivo' in r ? r.motivo : '');

/** E2 (aceite 2.2/2.3): 1 envelope bem-sucedido, 2 pernas, entrada ou saída. */
const ISS = 'GISSUER', DIST = 'GDIST', INV = 'GINV', TES = 'GTESOURO';
const pg = (asset: string, from: string, to: string, amount = '10.0000000', source = from): OpLida =>
  ({ type: 'payment', asset, from, to, amount, source });
const PLI = `PLINARF:${ISS}`, PLIB = `PLINARFB:${ISS}`, TS = `TESOURO:${TES}`;
const ctx = { issuer: ISS, distributor: DIST, bridgeCode: 'TESOURO' };

describe('classificarSwap', () => {
  it('ENTRADA: TESOURO investidor→distributor + PLINARF issuer→investidor', () => {
    const r = classificarSwap({ sucesso: true, ops: [pg(TS, INV, DIST, '10.0000000'), pg(PLI, ISS, INV, '9.4117647')] }, ctx);
    expect(r).toMatchObject({ confere: true, tipo: 'ENTRADA', investidor: INV, plinarf: '9.4117647', tesouro: '10.0000000' });
  });

  it('SAÍDA: PLINARF investidor→issuer (queima) + TESOURO distributor→investidor', () => {
    const r = classificarSwap({ sucesso: true, ops: [pg(PLI, INV, ISS, '376.4705882'), pg(TS, DIST, INV, '340.2300000')] }, ctx);
    expect(r).toMatchObject({ confere: true, tipo: 'SAIDA', investidor: INV, plinarf: '376.4705882', tesouro: '340.2300000' });
  });

  it('subordinada (PLINARFB) também vale', () => {
    expect(classificarSwap({ sucesso: true, ops: [pg(TS, INV, DIST), pg(PLIB, ISS, INV)] }, ctx)).toMatchObject({ confere: true, tipo: 'ENTRADA' });
  });

  it.each<[string, OpLida[], RegExp]>([
    ['modelo antigo: PLINARF sai do distributor, não do issuer', [pg(TS, INV, DIST), pg(PLI, DIST, INV)], /NAO_E_SWAP_E2/],
    ['saída que devolve ao distributor em vez de queimar', [pg(PLI, INV, DIST), pg(TS, DIST, INV)], /NAO_E_SWAP_E2/],
    ['1 perna só', [pg(TS, INV, DIST)], /PERNAS/],
    ['3 operações', [pg(TS, INV, DIST), pg(PLI, ISS, INV), pg(TS, INV, DIST)], /PERNAS/],
    ['pernas com investidores diferentes', [pg(TS, INV, DIST), pg(PLI, ISS, 'GOUTRO')], /NAO_E_SWAP_E2/],
    ['ativo-ponte de outro código', [pg(`USDC:${TES}`, INV, DIST), pg(PLI, ISS, INV)], /NAO_E_SWAP_E2/],
    ['PLINARF de outro emissor', [pg(TS, INV, DIST), pg(`PLINARF:GFAKE`, 'GFAKE', INV)], /NAO_E_SWAP_E2/],
  ])('recusa: %s', (_n, ops, re) => {
    const r = classificarSwap({ sucesso: true, ops }, ctx);
    expect(r.confere).toBe(false);
    expect(motivo(r)).toMatch(re);
  });

  it('operação que não é payment → PERNAS', () => {
    const r = classificarSwap({ sucesso: true, ops: [pg(TS, INV, DIST), { ...pg(PLI, ISS, INV), type: 'path_payment_strict_send' }] }, ctx);
    expect(motivo(r)).toMatch(/PERNAS/);
  });

  it('tx que falhou no ledger → TX_FALHOU', () => {
    const r = classificarSwap({ sucesso: false, ops: [pg(TS, INV, DIST), pg(PLI, ISS, INV)] }, ctx);
    expect(motivo(r)).toMatch(/TX_FALHOU/);
  });
});
