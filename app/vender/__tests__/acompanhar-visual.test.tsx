// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => 'tok' }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';
import StepperVender from '@/components/vender/StepperVender';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base: AcompanharData = {
  leadId: 'l1', cedenteNome: 'Cedente Teste', status: 'OFERTA_ENVIADA', etapaAtual: 3, contextoDescricao: 'x', ofertaId: 'o1',
  oferta: { valorCarta: 150000, desagioPct: '20.0', valorLiquido: 120000, prazoRestanteMeses: 0, validade: '01/12/2026 12:00' },
  cessaoId: null, consentTx: null, cessaoTx: null, pixTx: null, temCota: false,
};

describe('revisão visual da Íris (R-1 a R-5)', () => {
  it('R-1: o botão diz "Aceitar proposta →" (não "oferta") e tem 44 px de altura mínima', () => {
    render(<AcompanharView data={base} />);
    const b = screen.getByRole('button', { name: 'Aceitar proposta →' });
    expect(b.className).toContain('min-h-[44px]');
    expect(screen.queryByText(/Aceitar oferta/)).toBeNull();
  });

  it('R-2: as linhas da proposta empilham no celular e deixam o valor quebrar (sem estouro a 390)', () => {
    const { container } = render(<AcompanharView data={base} />);
    const linha = container.querySelector('div.flex-col.sm\\:flex-row')!;
    expect(linha).toBeTruthy();
    const valor = linha.querySelectorAll('span')[1]!;
    expect(valor.className).toContain('break-words');
    expect(valor.className).not.toContain('shrink-0');
  });

  it('R-3: Pix enviado e cota NÃO incorporada: sem botão "Concluído", sem 6 ✓; o rodapé leva a "Minhas solicitações"', () => {
    render(<AcompanharView data={{ ...base, status: 'PIX_EXECUTADO', etapaAtual: 6, temCota: false }} />);
    expect(screen.queryByText('Concluído')).toBeNull();
    const link = screen.getByRole('link', { name: 'Ver minhas solicitações →' });
    expect(link.getAttribute('href')).toBe('/vender/minhas');
    // só os círculos do stepper (o painel do Pix tem um ✓ decorativo próprio)
    const checks = [...document.querySelector('ol')!.querySelectorAll('span')].filter((e) => e.textContent === '✓');
    expect(checks.length).toBe(5); // as 5 primeiras; a última etapa não é ✓ sem a cota
  });

  it('R-3: com a cota incorporada, o rodapé é navegação ("Ver o pool →") e as 6 etapas ficam ✓', () => {
    render(<AcompanharView data={{ ...base, status: 'COTA_INCORPORADA', etapaAtual: 6, temCota: true }} />);
    expect(screen.getByRole('link', { name: 'Ver o pool →' }).getAttribute('href')).toBe('/pool');
    const checks = [...document.querySelector('ol')!.querySelectorAll('span')].filter((e) => e.textContent === '✓');
    expect(checks.length).toBe(6);
  });

  it('R-4: o stepper rola a etapa atual para a vista dentro da faixa (sem rolar a página)', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 736 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 390 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 32 });
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const atual = this.getAttribute('aria-current') === 'step';
      return { left: atual ? 500 : 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const { container } = render(<StepperVender current={4} />);
    const faixa = container.firstElementChild as HTMLElement;
    // alvo = 500 - 0 + 0; centraliza: 500 - (390 - 32) / 2 = 321
    expect(faixa.scrollLeft).toBe(321);
    rect.mockRestore();
    // @ts-expect-error limpeza dos getters de teste
    delete HTMLElement.prototype.scrollWidth; delete HTMLElement.prototype.clientWidth; delete HTMLElement.prototype.offsetWidth;
  });

  it('R-5: links e botões do rodapé têm alvo de 44 px', () => {
    render(<AcompanharView data={{ ...base, status: 'OFERTA_ACEITA', etapaAtual: 4, cessaoId: 'c1', cessaoTx: { hashShort: 'abcd1234', url: 'https://x.test/tx' } }} />);
    for (const nome of [/Voltar/, /Avançar/]) expect(screen.getByRole('button', { name: nome }).className).toContain('min-h-[44px]');
    for (const link of [...screen.getAllByRole('link', { name: /Ver comprovante|Stellar Expert/ })]) expect(link.className).toContain('min-h-[44px]');
  });

  it('diagrama Cota → Pool → Token: empilha no celular e deixa o texto quebrar (sem passar da borda a 390)', () => {
    const { container } = render(<AcompanharView data={{ ...base, status: 'COTA_INCORPORADA', etapaAtual: 6, temCota: true }} />);
    const d = container.querySelector('[data-testid="diagrama-cota-pool-token"]')!;
    expect(d.className).toContain('flex-col');
    expect(d.className).toContain('sm:flex-row');
    expect(d.className).toContain('min-w-0');
    const caixas = [...d.children].filter((c) => c.getAttribute('aria-hidden') !== 'true');
    expect(caixas.map((c) => c.textContent)).toEqual(['Cota', 'Pool', 'Token de demonstração · Stellar testnet']);
    for (const c of caixas) {
      expect(c.className).toContain('min-w-0');
      expect(c.className).toContain('break-words');
      expect(c.className).toContain('sm:flex-1');
    }
    // setas decorativas: escondidas dos leitores de tela; ↓ no celular, → de sm em diante
    expect(d.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
    expect(d.textContent).toContain('↓');
    expect(d.textContent).toContain('→');
  });
});
