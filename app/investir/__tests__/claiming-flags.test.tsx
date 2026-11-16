// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimingScreen } from '../_components/screens/claiming';

afterEach(cleanup);

const onRamp = { orderId: 'o', status: 'completed', paymentInstructions: null, mock: false, stellarClaimableBalanceId: 'cb-fict' };
const montar = () => render(<ClaimingScreen onRamp={onRamp} claimResult={null} claiming={false} swapLoading={false} onClaim={() => {}} onContinue={() => {}} />);

describe('ClaimingScreen: bloco de flags do ativo', () => {
  it('região de rolagem nomeada e alcançável pelo teclado, com o conteúdo inteiro preservado', () => {
    montar();
    const regiao = screen.getByRole('region', { name: /Flags do ativo PLINA-RF/ });
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.className).toContain('overflow-x-auto');
    expect(regiao.className).toContain('focus-visible:outline-primary-deep');
    expect(regiao.textContent).toContain('AUTH_CLAWBACK_ENABLED');
    expect(regiao.textContent).toContain('liquidação atômica em resgates e cross-border');
  });

  it('dica de rolagem só no mobile (md:hidden)', () => {
    montar();
    const dica = screen.getByTestId('flags-dica-rolagem');
    expect(dica.textContent).toBe('Role para o lado para ver as linhas inteiras');
    expect(dica.className).toContain('md:hidden');
  });
});
