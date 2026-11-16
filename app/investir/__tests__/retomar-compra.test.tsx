// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaseOrdemPendente } from '@/lib/services/ordem-pendente';
import type { OrdemPendente } from '../_types';
import { AVISO_PAGAMENTO_SIMULADO, RetomarCompra, TEXTO_RETOMADA } from '../_components/shared/retomar-compra';

afterEach(cleanup);
const ordem = (fase: FaseOrdemPendente): OrdemPendente => ({
  fase,
  criadoEm: '2026-11-16T10:00:00.000Z',
  quote: { quoteId: 'q', fromAmount: '300', toAmount: '307', exchangeRate: '1', fee: '0', expiresAt: '2026-11-16T10:02:00.000Z' },
  onRamp: { orderId: 'o', status: 'completed', paymentInstructions: null, mock: false },
});

describe('RetomarCompra (U2 A-02)', () => {
  it.each(['aguardando_pagamento', 'liquidando', 'resgatar_tesouro', 'concluir_swap'] as const)('fase %s: mostra o título e o botão, e o clique retoma', (fase) => {
    const onRetomar = vi.fn();
    render(<RetomarCompra pendente={ordem(fase)} retomando={false} onRetomar={onRetomar} />);
    expect(screen.getByRole('heading', { name: TEXTO_RETOMADA[fase].titulo })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXTO_RETOMADA[fase].botao! }));
    expect(onRetomar).toHaveBeenCalledTimes(1);
  });

  it('o caso do TESOURO parado diz com todas as letras: TESOURO na carteira, conclua a compra', () => {
    render(<RetomarCompra pendente={ordem('concluir_swap')} retomando={false} onRetomar={() => undefined} />);
    expect(screen.getByRole('heading').textContent).toBe('Você tem TESOURO na carteira: conclua a compra');
    expect(screen.getByRole('button', { name: 'Concluir compra' })).toBeTruthy();
  });

  it('em_conferencia: SEM botão (nada a fazer; refazer dobraria a compra) e pede para não refazer', () => {
    render(<RetomarCompra pendente={ordem('em_conferencia')} retomando={false} onRetomar={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('retomar-compra').textContent).toMatch(/Não refaça a compra/);
  });

  it('retomando: o botão fica desabilitado, "Preparando…", e não dispara de novo', () => {
    const onRetomar = vi.fn();
    render(<RetomarCompra pendente={ordem('concluir_swap')} retomando onRetomar={onRetomar} />);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Preparando…');
    fireEvent.click(b);
    expect(onRetomar).not.toHaveBeenCalled();
  });

  it('Norma (16/11): as fases de pagamento dizem que em rede de testes o pagamento é simulado', () => {
    expect(AVISO_PAGAMENTO_SIMULADO).toBe('Em rede de testes, o pagamento é simulado.');
    for (const fase of ['aguardando_pagamento', 'resgatar_tesouro', 'concluir_swap'] as const) {
      expect(TEXTO_RETOMADA[fase].texto).toContain(AVISO_PAGAMENTO_SIMULADO);
    }
  });
  it('Norma (16/11): "Pix" vira "pagamento" na fase de espera; o claim é "Receber TESOURO" (resgate fica só para a saída de tokens)', () => {
    expect(TEXTO_RETOMADA.aguardando_pagamento.titulo).toBe('Você tem uma compra aguardando o pagamento');
    expect(TEXTO_RETOMADA.aguardando_pagamento.texto).not.toMatch(/Pix/);
    expect(TEXTO_RETOMADA.resgatar_tesouro.titulo).toBe('Falta receber o seu TESOURO');
    expect(TEXTO_RETOMADA.resgatar_tesouro.botao).toBe('Receber TESOURO');
    const todos = Object.values(TEXTO_RETOMADA).map((t) => `${t.titulo} ${t.texto} ${t.botao ?? ''}`).join(' ');
    expect(todos).not.toMatch(/resgat/i);
  });
  it('Norma (16/11): "em conferência" não promete prazo', () => {
    expect(TEXTO_RETOMADA.em_conferencia.texto).toBe('Já enviamos a troca e estamos conferindo na rede. Não refaça a compra.');
    expect(Object.values(TEXTO_RETOMADA).map((t) => t.texto).join(' ')).not.toMatch(/alguns minutos|em breve|instantes/i);
  });

  it('alvo de toque ≥ 44 px e nenhum texto promete mais que o sistema sabe (sem "rendimento", "retorno", "garantido")', () => {
    render(<RetomarCompra pendente={ordem('concluir_swap')} retomando={false} onRetomar={() => undefined} />);
    expect((screen.getByRole('button') as HTMLButtonElement).className).toContain('min-h-[44px]');
    const todos = Object.values(TEXTO_RETOMADA).map((t) => `${t.titulo} ${t.texto}`).join(' ');
    expect(todos).not.toMatch(/rendimento|retorno|garantid|lucro|investir no/i);
  });
});
