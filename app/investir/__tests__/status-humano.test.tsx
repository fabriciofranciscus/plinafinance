// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FUNDING_ROTULO, FUNDING_TEXTO, rotuloKyc } from '@/lib/format/status-humano';
import { IdentityScreen } from '../_components/screens/identity';

// A3 (backlog de usabilidade, 25/11): status crus e jargão na tela ("KYC NAO_INICIADO", "○ not_started", "friendbot · agora").
// A tela mostra texto humano; nenhum enum nem nome de ferramenta interna. Só exibição.
afterEach(cleanup);

describe('rotuloKyc: enum → texto humano, nos dois vocabulários do app', () => {
  it('vocabulário do banco (Pessoa.kycStatus)', () => {
    expect(rotuloKyc('NAO_INICIADO')).toBe('não iniciado');
    expect(rotuloKyc('PENDENTE')).toBe('em andamento');
    expect(rotuloKyc('APROVADO')).toBe('aprovado');
    expect(rotuloKyc('REJEITADO')).toBe('não aprovado');
  });
  it('vocabulário do /investir (onboard.kycStatus)', () => {
    expect(rotuloKyc('not_started')).toBe('não iniciado');
    expect(rotuloKyc('pending')).toBe('em andamento');
    expect(rotuloKyc('approved')).toBe('aprovado');
  });
  it('ausente ou desconhecido NUNCA vira o valor cru: texto neutro', () => {
    for (const v of [null, undefined, '', 'CODIGO_NOVO', 'xyz']) {
      const r = rotuloKyc(v);
      expect(r, String(v)).toBe('sem informação');
      expect(r).not.toMatch(/CODIGO_NOVO|xyz|NAO_|_/);
    }
  });
  it('nenhum rótulo contém sublinhado, caixa alta de enum nem o nome do enum', () => {
    for (const v of ['NAO_INICIADO', 'PENDENTE', 'APROVADO', 'REJEITADO', 'not_started', 'pending', 'approved']) {
      expect(rotuloKyc(v)).not.toMatch(/[_]|^[A-Z]{3,}/);
    }
  });
});

describe('/investir: a linha de status da verificação e o funding', () => {
  const base = { investidorId: 'i', publicKey: 'GFICT', etherfuseCustomerId: 'cust-fict-0001', fundedNow: false };
  const montar = (onboard: Record<string, unknown>) =>
    render(
      <IdentityScreen
        onboard={{ ...base, ...onboard } as never}
        onboarding={false}
        consented
        onConsent={() => {}}
        user={{ id: 'did:privy:fict' } as never}
        trustlinesReady={false}
        trustlineLoading={false}
        onSetupTrustlines={() => {}}
        onContinue={() => {}}
        onRetry={() => {}}
        track="BR"
        onTrackChange={() => {}}
        institutionalProfile={null}
        onInstitutionalChange={() => {}}
      />,
    );

  it('"pending" e "not_started" saem como texto humano, sem o valor cru', () => {
    for (const [cru, humano] of [['pending', '○ em andamento'], ['not_started', '○ não iniciado']] as const) {
      cleanup();
      const { container } = montar({ kycStatus: cru });
      expect(container.textContent, cru).toContain(humano);
      expect(container.textContent, cru).not.toContain(`○ ${cru}`);
      expect(container.textContent, cru).not.toMatch(/not_started/);
    }
  });
  it('aprovado continua "● aprovado"', () => {
    const { container } = montar({ kycStatus: 'approved' });
    expect(container.textContent).toContain('● aprovado');
  });
  it('o funding não cita "friendbot": rótulo e texto vêm do arquivo de rótulos', () => {
    const { container } = montar({ kycStatus: 'approved', fundedNow: true });
    expect(container.textContent).not.toMatch(/friendbot/i);
    expect(container.textContent).toContain(FUNDING_ROTULO);
    expect(container.textContent).toContain(FUNDING_TEXTO);
    expect(FUNDING_TEXTO).not.toMatch(/friendbot|funding/i);
  });
  it('sem funding agora, a linha não aparece', () => {
    montar({ kycStatus: 'approved', fundedNow: false });
    expect(screen.queryByText(FUNDING_TEXTO)).toBeNull();
  });
});

describe('/painel: o selo de KYC não imprime o enum cru', () => {
  const src = readFileSync('app/painel/page.tsx', 'utf8');
  it('usa rotuloKyc e não interpola pessoa.kycStatus direto', () => {
    expect(src).toContain("from '@/lib/format/status-humano'");
    expect(src).toMatch(/rotuloKyc\(pessoa\.kycStatus\)/);
    expect(src).not.toMatch(/KYC \$\{pessoa\.kycStatus/);
  });
});
