import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';
import { LeadVendedorStatus } from '@prisma/client';
import { contextoDoStatus } from '@/lib/vender/etapas';

const data: AcompanharData = {
  leadId: 'lead-1', cedenteNome: 'Cedente Teste', status: 'OFERTA_ACEITA', etapaAtual: 4,
  contextoDescricao: 'x', ofertaId: 'of-1', oferta: null, cessaoId: 'ces-1',
  consentTx: null, cessaoTx: null, pixTx: null, temCota: false,
};

describe('copy do /vender/acompanhar (Norma/Consuelo, 15/11)', () => {
  const html = renderToStaticMarkup(<AcompanharView data={data} />);
  it('C1: cessionária identificada como projeto em fase de testes; sem "Securitizadora S.A."', () => {
    expect(html).toContain('Cessionária: Plina Finance (projeto em fase de testes, empresa em constituição)');
    expect(html).not.toContain('Securitizadora');
  });
  it('C3: assinatura por link de e-mail, com a caixa de spam; sem botão de e-CPF nem "em breve"', () => {
    expect(html).toContain('link de e-mail que a equipe envia nesta etapa. Verifique a caixa de spam.');
    expect(html).not.toContain('e-CPF');
    expect(html).not.toContain('em breve');
    expect(html).not.toMatch(/<button[^>]*>[^<]*Assinar/);
  });
  it('C2 e "firme": etapas sem "responda o e-mail" nem "oferta firme"', () => {
    const todos = Object.values(LeadVendedorStatus).map((st) => JSON.stringify(contextoDoStatus(st))).join(' ');
    expect(todos).not.toMatch(/oferta firme/i);
    expect(JSON.stringify(contextoDoStatus('OFERTA_ENVIADA'))).not.toMatch(/responda o e-mail/i);
    expect(JSON.stringify(contextoDoStatus('OFERTA_ENVIADA'))).toContain('Proposta enviada');
    expect(JSON.stringify(contextoDoStatus('OFERTA_ENVIADA'))).toContain('Para aceitar, use o botão Aceitar nesta página.');
    expect(JSON.stringify(contextoDoStatus('DOCS_RECEBIDOS'))).toContain('para gerar a proposta.');
  });
});
