// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnRampData, QuoteData } from '../_types';
import { SettlingScreen } from '../_components/screens/settling';
import { TEXTO_LIQUIDACAO } from '../_lib/texto-liquidacao';

const quote: QuoteData = { quoteId: 'q', fromAmount: '300', toAmount: '307', plinarfAmount: '300', exchangeRate: '1', fee: '0', expiresAt: '2026-11-16T10:02:00.000Z' };
const onRamp = (over: Partial<OnRampData> = {}): OnRampData => ({
  orderId: 'or-1234567abcdef', status: 'processing', paymentInstructions: null, mock: false,
  stellarTxHash: null, stellarClaimableBalanceId: null, claimTxHash: null, ...over,
});
const montar = (o: OnRampData, extra: Partial<{ onAtualizar: () => void; atualizando: boolean }> = {}) =>
  render(<SettlingScreen onRamp={o} quote={quote} swapLoading={false} onContinue={() => undefined} onAtualizar={extra.onAtualizar ?? (() => undefined)} atualizando={extra.atualizando ?? false} />);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T12:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SettlingScreen — limite de confirmação (U2 A-09)', () => {
  it('dentro do limite: diz que a página se atualiza sozinha e mostra o tempo de espera que passa (sem prazo); sem as saídas de atraso', () => {
    montar(onRamp({ desde: '2026-11-16T11:58:48Z', atrasada: false, limiteSegundos: 180 })); // 72 s de espera
    expect(screen.getByRole('heading').textContent).toBe(TEXTO_LIQUIDACAO.espera.titulo);
    expect(document.body.textContent).toContain('Ainda não chegou a confirmação. Esta página se atualiza sozinha.');
    expect(document.body.textContent).not.toMatch(/\d+ minutos|costuma levar|mais do que o normal/i); // prazo/comparação com prazo fora da tela (Norma)
    expect(screen.getByTestId('tempo-de-espera').textContent).toBe('01:12');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('tempo-de-espera').textContent).toBe('01:15');
    expect(screen.queryByRole('button', { name: 'Atualizar agora' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Falar com a equipe' })).toBeNull();
  });

  it('atrasada: título honesto e as TRÊS saídas (atualizar agora, voltar ao início, falar com a equipe)', () => {
    montar(onRamp({ desde: '2026-11-16T11:50:00Z', atrasada: true, limiteSegundos: 180 }));
    expect(screen.getByRole('heading').textContent).toBe('A confirmação ainda não chegou.');
    expect(screen.getByRole('button', { name: 'Atualizar agora' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar ao início' }).getAttribute('href')).toBe('/inicio');
    expect(screen.getByRole('link', { name: 'Falar com a equipe' }).getAttribute('href')).toMatch(/^mailto:contato@plina\.finance\?/);
  });

  it('o e-mail para a equipe leva o número CURTO da ordem e nenhum dado pessoal', () => {
    montar(onRamp({ desde: '2026-11-16T11:50:00Z', atrasada: true }));
    const href = decodeURIComponent(screen.getByRole('link', { name: 'Falar com a equipe' }).getAttribute('href')!);
    expect(href).toContain('ordem #ABCDEF');
    expect(href).not.toContain('or-1234567abcdef'); // só o final do id
    expect(href).not.toMatch(/cpf|chave|@exemplo|G[A-Z2-7]{55}/i);
  });

  it('"Atualizar agora" consulta já; durante a consulta fica desabilitado', () => {
    const onAtualizar = vi.fn();
    const { rerender } = montar(onRamp({ desde: '2026-11-16T11:50:00Z', atrasada: true }), { onAtualizar });
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(onAtualizar).toHaveBeenCalledTimes(1);
    rerender(<SettlingScreen onRamp={onRamp({ desde: '2026-11-16T11:50:00Z', atrasada: true })} quote={quote} swapLoading={false} onContinue={() => undefined} onAtualizar={onAtualizar} atualizando />);
    expect((screen.getByRole('button', { name: /Atualizando/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('o texto falso sumiu: nada de "antes de marcar falha" nem "Indexing grace" (o código não marca falha)', () => {
    montar(onRamp({ desde: '2026-11-16T11:58:00Z', atrasada: false }));
    expect(document.body.textContent).not.toMatch(/marcar falha|indexing grace|settlement/i);
  });

  it('não promete prazo de estorno nem de resolução', () => {
    montar(onRamp({ desde: '2026-11-16T11:50:00Z', atrasada: true }));
    expect(document.body.textContent).not.toMatch(/estorn|reembols|em até \d+ (horas|dias)|garant/i);
  });

  it('as fases de pagamento dizem que em rede de testes o pagamento é simulado (regra da Norma)', () => {
    for (const t of [TEXTO_LIQUIDACAO.espera.texto, TEXTO_LIQUIDACAO.atrasada.texto]) {
      expect(t).toContain('Em rede de testes, o pagamento é simulado.');
    }
  });

  it('quando a ordem anda (claimable balance emitido) a tela segue como sempre: botão de continuar habilitado, sem saídas de atraso', () => {
    montar(onRamp({ status: 'processing', stellarClaimableBalanceId: 'cb1', atrasada: false }));
    expect((screen.getByRole('button', { name: 'Continuar para revisão do swap' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('link', { name: 'Falar com a equipe' })).toBeNull();
  });

  it('atrasada MAS já andou (completed): a tela não fica presa no aviso de atraso', () => {
    montar(onRamp({ status: 'completed', atrasada: true }));
    expect(screen.queryByText('A confirmação ainda não chegou.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continuar para revisão do swap' })).toBeTruthy();
  });
});
