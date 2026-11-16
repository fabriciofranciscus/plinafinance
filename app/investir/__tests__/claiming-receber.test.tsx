// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimingScreen } from '../_components/screens/claiming';
import { CLAIM_XDR_EXPIRADO_MESSAGE } from '../_lib/claim-submit';
import { SCREENS } from '../_lib/glossary';

afterEach(cleanup);

// Glossário da Norma (16/11): o claim é "receber"/"recebimento"; "resgate" fica só para a saída de tokens.
const onRamp = { orderId: 'o', status: 'completed', paymentInstructions: null, mock: false, stellarClaimableBalanceId: 'cb-fict' };
const montar = (o: { claiming?: boolean; regenerated?: boolean } = {}) =>
  render(<ClaimingScreen onRamp={onRamp} claimResult={null} claiming={!!o.claiming} regenerated={o.regenerated} swapLoading={false} onClaim={() => {}} onContinue={() => {}} />);

describe('tela de claim do /investir usa "receber"', () => {
  it('eyebrow e título', () => {
    montar();
    expect(document.body.textContent).toContain('06 // Recebimento do TESOURO');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assine para receber o TESOURO');
  });

  it('botão de assinatura', () => {
    montar();
    expect(screen.getByRole('button').textContent).toBe('Assinar e receber TESOURO');
  });

  it('transação regenerada: aviso e botão', () => {
    montar({ regenerated: true });
    expect(screen.getByTestId('claim-regenerado').textContent).toContain('A transação de recebimento venceu e foi gerada de novo.');
    expect(screen.getByRole('button').textContent).toBe('Assinar o novo recebimento');
  });

  it('nenhum texto da tela (fora do bloco técnico de flags) fala em "resgat" ou "reclam"', () => {
    montar({ regenerated: true });
    const texto = [
      document.querySelector('h1')?.textContent,
      document.querySelector('p')?.textContent,
      screen.getByTestId('claim-regenerado').textContent,
      screen.getByRole('button').textContent,
    ].join(' ');
    expect(texto).not.toMatch(/resgat|reclam/i);
  });

  it('mensagem de XDR expirado e rótulo do passo', () => {
    expect(CLAIM_XDR_EXPIRADO_MESSAGE).toBe('A transação de recebimento expirou. Tente novamente para gerar uma nova.');
    expect(SCREENS.find((s) => s.id === 'claiming')?.label).toBe('Recebimento');
  });
});
