import { describe, it, expect } from 'vitest';
import { ClaimError } from '@/lib/stellar/claim';

/** Glossário 'receber' (Atlas/Norma, 16/11): a tela e as rotas não dizem 'reclamar' nem 'claimable balance'. */
describe('ClaimError — mensagens no glossário "receber"', () => {
  const codes = ['CB_NOT_FOUND', 'NOT_CLAIMANT', 'ACCOUNT_MISSING', 'RESERVA_INSUFICIENTE', 'APORTE_FORA_DO_TETO'] as const;

  it('nenhuma mensagem diz "reclam…" nem "claimable balance"', () => {
    for (const c of codes) {
      const m = new ClaimError(c).message;
      expect(m, c).not.toMatch(/reclam/i);
      expect(m, c).not.toMatch(/claimable balance/i);
    }
  });

  it('CB_NOT_FOUND fala em saldo a receber', () => {
    expect(new ClaimError('CB_NOT_FOUND').message).toMatch(/saldo a receber/i);
  });
});
