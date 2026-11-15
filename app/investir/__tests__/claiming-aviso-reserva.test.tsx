// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimingScreen } from '../_components/screens/claiming';

afterEach(cleanup);

const onRamp = { orderId: 'o', status: 'completed', paymentInstructions: null, mock: false, stellarClaimableBalanceId: 'cb-fict' };
const TX = 'f1c7'.padEnd(64, '0');
const montar = (claimed: boolean) =>
  render(
    <ClaimingScreen
      onRamp={claimed ? { ...onRamp, claimTxHash: TX } : onRamp}
      claimResult={claimed ? { claimTxHash: TX, balanceId: 'cb-fict' } : null}
      claiming={false}
      swapLoading={false}
      onClaim={() => {}}
      onContinue={() => {}}
    />,
  );

describe('ClaimingScreen: instrução antes da assinatura x aviso da reserva', () => {
  it('antes do resgate: instrução e aviso da reserva', () => {
    montar(false);
    expect(screen.getByTestId('claim-instrucao').textContent).toContain('Esta transação abre a trustline do TESOURO, se ela ainda não existir, e recebe o TESOURO.');
    expect(screen.getByTestId('aviso-reserva').textContent).toBe('A reserva de 0,5 XLM fica bloqueada na sua carteira.');
  });

  it('depois do resgate: a instrução some (não fala mais no futuro) e o aviso da reserva permanece', () => {
    montar(true);
    expect(screen.queryByTestId('claim-instrucao')).toBeNull();
    expect(document.body.textContent).not.toContain('você assina uma única transação');
    expect(screen.getByTestId('aviso-reserva').textContent).toBe('A reserva de 0,5 XLM fica bloqueada na sua carteira.');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('TESOURO na sua trustline — prossiga');
  });
});
