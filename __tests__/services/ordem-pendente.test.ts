import { describe, expect, it } from 'vitest';
import { faseDaOrdem, LIMITE_CONFIRMACAO_ONRAMP_S, onrampAtrasado, STATUS_ORDEM_ENCERRADA, type OrdemParaFase } from '@/lib/services/ordem-pendente';

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

describe('onrampAtrasado (U2 A-09): a ordem paga que o anchor não confirma', () => {
  const AGORA = new Date('2026-11-16T12:00:00Z');
  const ha = (seg: number) => new Date(AGORA.getTime() - seg * 1000);
  const o = (over: Partial<{ status: string; cb: string | null; seg: number }> = {}) => ({
    status: over.status ?? 'processing',
    stellarClaimableBalanceId: over.cb === undefined ? null : over.cb,
    atualizadoEm: ha(over.seg ?? 0),
  });

  it('o limite é de 180 s', () => {
    expect(LIMITE_CONFIRMACAO_ONRAMP_S).toBe(180);
  });
  it('fronteira: 180 s ainda NÃO é atraso; 181 s é', () => {
    expect(onrampAtrasado(o({ seg: 180 }), AGORA)).toBe(false);
    expect(onrampAtrasado(o({ seg: 181 }), AGORA)).toBe(true);
  });
  it('processing sem claimable balance há horas → atrasada', () => {
    expect(onrampAtrasado(o({ seg: 6 * 3600 }), AGORA)).toBe(true);
  });
  it('pending (a pessoa ainda não pagou) NUNCA é atraso, por mais antiga que seja', () => {
    expect(onrampAtrasado(o({ status: 'pending', seg: 6 * 3600 }), AGORA)).toBe(false);
  });
  it('processing COM claimable balance (o anchor já entregou o TESOURO) não é atraso', () => {
    expect(onrampAtrasado(o({ cb: 'cb1', seg: 6 * 3600 }), AGORA)).toBe(false);
  });
  it.each(['completed', 'failed', 'expired', 'cancelled', 'refunded', 'status-novo'])('status %s nunca é atraso', (status) => {
    expect(onrampAtrasado(o({ status, seg: 6 * 3600 }), AGORA)).toBe(false);
  });
  it('relógio à frente (atualizadoEm no futuro) não vira atraso', () => {
    expect(onrampAtrasado({ status: 'processing', stellarClaimableBalanceId: null, atualizadoEm: new Date(AGORA.getTime() + 60_000) }, AGORA)).toBe(false);
  });
});

