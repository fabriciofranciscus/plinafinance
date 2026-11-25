// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FUNDING_ROTULO, FUNDING_TEXTO, ROTULO_VERIFICACAO, rotuloKyc, seloVerificacao } from '@/lib/format/status-humano';
import { IdentityScreen } from '../_components/screens/identity';

// A3 (backlog de usabilidade, 25/11): status crus e jargão na tela ("KYC NAO_INICIADO", "○ not_started", "friendbot · agora").
// A tela mostra texto humano; nenhum enum nem nome de ferramenta interna. Só exibição.
afterEach(cleanup);

describe('rotuloKyc: enum → texto humano, nos dois vocabulários do app', () => {
  it('vocabulário do banco (Pessoa.kycStatus)', () => {
    // Feminino: o nome mostrado é "Verificação de identidade" (glossário U3, Consuelo). "KYC" não é rótulo para o usuário.
    expect(rotuloKyc('NAO_INICIADO')).toBe('não iniciada');
    expect(rotuloKyc('PENDENTE')).toBe('em andamento');
    expect(rotuloKyc('APROVADO')).toBe('aprovada');
    expect(rotuloKyc('REJEITADO')).toBe('não aprovada');
  });
  it('vocabulário do /investir (onboard.kycStatus)', () => {
    expect(rotuloKyc('not_started')).toBe('não iniciada');
    expect(rotuloKyc('pending')).toBe('em andamento');
    expect(rotuloKyc('approved')).toBe('aprovada');
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
    for (const [cru, humano] of [['pending', '○ em andamento'], ['not_started', '○ não iniciada']] as const) {
      cleanup();
      const { container } = montar({ kycStatus: cru });
      expect(container.textContent, cru).toContain(humano);
      expect(container.textContent, cru).not.toContain(`○ ${cru}`);
      expect(container.textContent, cru).not.toMatch(/not_started/);
    }
  });
  it('aprovada: "● aprovada"; e a linha se chama "Verificação de identidade", não "KYC status"', () => {
    const { container } = montar({ kycStatus: 'approved' });
    expect(container.textContent).toContain('● aprovada');
    expect(screen.getByText(ROTULO_VERIFICACAO)).toBeTruthy();
    expect(container.textContent).not.toMatch(/KYC status/);
  });
  it('o funding não cita "friendbot": rótulo e texto vêm do arquivo de rótulos', () => {
    const { container } = montar({ kycStatus: 'approved', fundedNow: true });
    expect(container.textContent).not.toMatch(/friendbot/i);
    expect(container.textContent).toContain(FUNDING_ROTULO);
    expect(container.textContent).toContain(FUNDING_TEXTO);
    expect(FUNDING_TEXTO).not.toMatch(/friendbot|funding/i);
    // Norma (25/11): "agora" sugeriria que o saldo chega a cada uso; é só na criação da conta.
    expect(FUNDING_ROTULO).toBe('Saldo inicial');
    // Norma: "na criação da conta" (não "agora"). Consuelo: sempre dizer que é da rede de testes e sem valor real.
    expect(FUNDING_TEXTO).toBe('XLM de teste da rede de testes, sem valor real, recebido na criação da conta.');
    expect(FUNDING_TEXTO).not.toMatch(/agora/);
  });
  it('a espera da verificação fala em "parceiro de pagamento", sem "anchor" nem "webhook" (Norma)', () => {
    const { container } = montar({ kycStatus: 'pending' });
    const t = screen.getByTestId('kyc-pending').textContent;
    expect(t).toBe('Aguardando a confirmação do parceiro de pagamento. Esta tela atualiza sozinha.');
    expect(t).not.toMatch(/anchor|webhook/i);
    cleanup();
    const atraso = render(
      <IdentityScreen
        onboard={{ ...base, kycStatus: 'pending' } as never}
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
        kycTimedOut
      />,
    );
    const a = within(atraso.container).getByTestId('kyc-pending').textContent;
    expect(a).toBe('A verificação ainda não foi confirmada pelo parceiro de pagamento. Recarregue a página mais tarde.');
    expect(a).not.toMatch(/anchor|webhook/i);
    expect(container).toBeTruthy();
  });
  it('o sobretítulo da tela se chama "Verificação de identidade", não "Identidade · KYC"', () => {
    const { container } = montar({ kycStatus: 'approved' });
    expect(container.textContent).toContain('02 // Verificação de identidade');
    expect(container.textContent).not.toContain('Identidade · KYC');
  });
  it('título, introdução e consentimento falam em "verificação de identidade": nenhum "KYC" e nenhuma "anchor regulada" (Norma, Consuelo)', () => {
    const src = readFileSync('app/investir/_components/screens/identity.tsx', 'utf8');
    const texto = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\s+/g, ' ');
    expect(texto).not.toMatch(/KYC programático|KYC auto-aprovado|Identidade · KYC/);
    expect(texto).not.toMatch(/anchor regulada/i); // "regulada" é afirmação não verificada (⚖)
    // Norma (25/11, versão final): carteira, "parceira de pagamento", simulada em ambiente de teste; sem "dado real" afirmado.
    expect(texto).toContain('Sua carteira e a verificação de identidade.');
    expect(texto).toContain('A Plina cria sua carteira Stellar e envia seus dados à Etherfuse, parceira de pagamento, para a verificação de identidade. Em ambiente de teste, a verificação é simulada.');
    expect(texto).toContain('submissão da verificação de identidade no ambiente de teste (simulada).');
    expect(texto).not.toMatch(/Nenhum dado real é coletado|nenhum dado real é usado/);
    expect(texto).not.toMatch(/Wallet Stellar e verificação/);
  });
  it('quote e progresso do onboarding sem "anchor regulada" nem "KYC programático" (Norma)', () => {
    const quote = readFileSync('app/investir/_components/screens/quote.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(quote).toContain('Cotação ao vivo do parceiro de pagamento.');
    expect(quote).not.toMatch(/anchor regulada|Quote ao vivo/);
    const prog = readFileSync('app/investir/_components/shared/onboarding-progress.tsx', 'utf8');
    expect(prog).toContain("'Enviando sua verificação de identidade',");
    expect(prog).not.toMatch(/KYC programático|Submetendo KYC/);
  });
  it('sem funding agora, a linha não aparece', () => {
    montar({ kycStatus: 'approved', fundedNow: false });
    expect(screen.queryByText(FUNDING_TEXTO)).toBeNull();
  });
});

describe('selo da verificação de identidade (/painel)', () => {
  it('o nome vem antes do status, no feminino, para aprovada e para os demais; nunca "KYC"', () => {
    expect(seloVerificacao(true, 'APROVADO')).toBe('● Verificação de identidade: aprovada');
    expect(seloVerificacao(false, 'NAO_INICIADO')).toBe('○ Verificação de identidade: não iniciada');
    expect(seloVerificacao(false, 'PENDENTE')).toBe('○ Verificação de identidade: em andamento');
    expect(seloVerificacao(false, 'REJEITADO')).toBe('○ Verificação de identidade: não aprovada'); // sem motivo da recusa
    expect(seloVerificacao(false, null)).toBe('○ Verificação de identidade: sem informação');
    for (const a of [true, false]) expect(seloVerificacao(a, 'x')).not.toMatch(/KYC|NAO_|_/);
  });
});

describe('/painel: o selo de KYC não imprime o enum cru', () => {
  const src = readFileSync('app/painel/page.tsx', 'utf8');
  it('usa rotuloKyc e não interpola pessoa.kycStatus direto', () => {
    expect(src).toContain("from '@/lib/format/status-humano'");
    expect(src).toMatch(/seloVerificacao\(pessoa\.kycAprovado, pessoa\.kycStatus\)/);
    expect(src).not.toMatch(/KYC \$\{pessoa\.kycStatus/);
    expect(src).not.toMatch(/KYC verificado|○ KYC/);
  });
});
