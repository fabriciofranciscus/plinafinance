import { describe, expect, it } from 'vitest';
import { faseDaOrdem, STATUS_ORDEM_ENCERRADA, type OrdemParaFase } from '@/lib/services/ordem-pendente';

const base = (o: Partial<Omit<OrdemParaFase, 'quote'>> & { quote?: Partial<OrdemParaFase['quote']> } = {}): OrdemParaFase => ({
  status: 'pending',
  stellarClaimableBalanceId: null,
  claimTxHash: null,
  ...o,
  quote: { submitXdrHash: null, consumedAt: null, ...(o.quote ?? {}) },
});

describe('faseDaOrdem (U2 A-02): em que passo a compra parou', () => {
  it.each([
    ['pending', null, null, 'aguardando_pagamento'],
    ['processing', null, null, 'liquidando'],
    ['processing', 'cb1', null, 'resgatar_tesouro'], // pago e já com claimable balance, falta o claim
    ['completed', 'cb1', null, 'resgatar_tesouro'],
    ['completed', 'cb1', 'claimtx', 'concluir_swap'], // claim feito, falta o swap (o caso do TESOURO parado)
    ['processing', 'cb1', 'claimtx', 'concluir_swap'],
    ['completed', null, null, 'concluir_swap'], // TESOURO pago direto na carteira (sem claimable balance)
  ])('status %s, claimable %s, claim %s → %s', (status, cb, claim, fase) => {
    expect(faseDaOrdem(base({ status, stellarClaimableBalanceId: cb, claimTxHash: claim }))).toBe(fase);
  });

  it('swap já ENVIADO e ainda sem escrituração → em_conferencia (sem ação; refazer dobraria a compra)', () => {
    expect(faseDaOrdem(base({ status: 'completed', claimTxHash: 'c', stellarClaimableBalanceId: 'cb', quote: { submitXdrHash: 'x'.repeat(64) } }))).toBe('em_conferencia');
  });

  it('swap concluído (quote consumido) → nada a retomar, em qualquer status', () => {
    for (const status of ['pending', 'processing', 'completed']) {
      expect(faseDaOrdem(base({ status, quote: { consumedAt: new Date() } }))).toBeNull();
    }
  });

  it.each(STATUS_ORDEM_ENCERRADA)('ordem %s (não vai gerar TESOURO) → nunca se oferece retomar', (status) => {
    expect(faseDaOrdem(base({ status, stellarClaimableBalanceId: 'cb', claimTxHash: 'c' }))).toBeNull();
    expect(faseDaOrdem(base({ status, quote: { submitXdrHash: 'x' } }))).toBeNull();
  });

  it('status desconhecido → fail-closed (nada a retomar)', () => {
    expect(faseDaOrdem(base({ status: 'algo-novo-do-anchor' }))).toBeNull();
  });

  it('em_conferencia vem ANTES da fase de dinheiro: nunca oferece "concluir swap" com swap em voo', () => {
    const f = faseDaOrdem(base({ status: 'completed', claimTxHash: 'c', stellarClaimableBalanceId: 'cb', quote: { submitXdrHash: 'x' } }));
    expect(f).not.toBe('concluir_swap');
  });
});
