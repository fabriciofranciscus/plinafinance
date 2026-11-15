import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

const data: AcompanharData = {
  leadId: 'l1', cedenteNome: 'Cedente Teste', status: 'COTA_INCORPORADA', etapaAtual: 6, contextoDescricao: 'x', ofertaId: 'o1',
  oferta: { valorCarta: 150000, desagioPct: '20.0', valorLiquido: 120000, prazoRestanteMeses: 0, validade: '01/12/2026 12:00' },
  cessaoId: 'c1', consentTx: null, cessaoTx: null, pixTx: null, temCota: true,
};

describe('"pool tokenizado público" saiu das telas do cedente (Consuelo, item 23)', () => {
  it('o rodapé da cota incorporada diz "pool de demonstração"', () => {
    const html = renderToStaticMarkup(<AcompanharView data={data} />);
    expect(html).toContain('Sua cota foi incorporada ao pool de demonstração. Composição em');
    expect(html).not.toMatch(/tokenizad|pool .*público/i);
  });

  it('o comprovante da cessão usa o mesmo texto', () => {
    const src = readFileSync('app/cessao/[id]/comprovante/page.tsx', 'utf8');
    expect(src).toContain('Sua cota foi incorporada ao pool de demonstração.');
    expect(src).not.toMatch(/pool tokenizado público/);
  });

  it('nenhum arquivo de tela (app, components) ainda diz "tokenizado" ao usuário', () => {
    for (const f of ['components/vender/AcompanharView.tsx', 'app/cessao/[id]/comprovante/page.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/tokenizado público/);
    }
  });
});
