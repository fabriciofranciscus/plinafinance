// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

afterEach(cleanup);

describe('A-15: etapa da cessão depois de assinada', () => {
  it('ao abrir a etapa "Cessão digital" com a cessão já assinada, não repete o aviso do link de e-mail', () => {
    const data: AcompanharData = {
      leadId: 'lead-1', cedenteNome: 'Cedente Teste', status: 'CESSAO_ASSINADA', etapaAtual: 5,
      contextoDescricao: 'x', ofertaId: 'of-1', oferta: null, cessaoId: 'ces-1',
      consentTx: null, cessaoTx: null, pixTx: null, temCota: false,
    };
    render(<AcompanharView data={data} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Cessão digital/ })[0]!);
    expect(screen.queryByTestId('assinatura-por-email')).toBeNull();
    expect(screen.getByText(/Cedente: Cedente Teste/)).toBeTruthy();
  });
});
