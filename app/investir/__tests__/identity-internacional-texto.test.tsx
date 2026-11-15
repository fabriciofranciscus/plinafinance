// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IdentityScreen } from '../_components/screens/identity';

afterEach(cleanup);

const onboard = { investidorId: 'i', publicKey: 'GFICT', etherfuseCustomerId: 'cust-fict-0001', kycStatus: 'approved' as const, fundedNow: false };
const noop = () => {};
const montar = (track: 'BR' | 'INTL') =>
  render(
    <IdentityScreen
      onboard={onboard}
      onboarding={false}
      consented
      onConsent={noop}
      user={{ id: 'did:privy:fict' } as never}
      trustlinesReady={false}
      trustlineLoading={false}
      onSetupTrustlines={noop}
      onContinue={noop}
      onRetry={noop}
      track={track}
      onTrackChange={noop}
      institutionalProfile={null}
      onInstitutionalChange={noop}
    />,
  );

describe('IdentityScreen, trilha internacional (A-28, Consuelo)', () => {
  it('não afirma MoneyGram, Settle nem SEP; diz que está em desenvolvimento e sem oferta', () => {
    montar('INTL');
    const t = document.body.textContent ?? '';
    expect(t).not.toMatch(/MoneyGram|Settle|SEP-|anchors europeias|onboarding hosted/);
    expect(t).toContain('Cadastro para investidores fora do Brasil: em desenvolvimento, ainda não disponível.');
    expect(t).toContain('Em desenvolvimento');
    expect(t).toContain('Sem oferta');
  });

  it('a trilha BR não mudou', () => {
    montar('BR');
    const t = document.body.textContent ?? '';
    expect(t).toContain('Cadastro da entidade brasileira (simulação em rede de testes).');
    expect(t).toContain('Cadastro BR');
    expect(t).not.toContain('Cadastro para investidores fora do Brasil');
  });
});
