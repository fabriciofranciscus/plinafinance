import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { VendedorPipeline } from '../vendedor-pipeline';
import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

/**
 * DS5 — estado "aguardando assinatura" entre o aceite e a assinatura, no funil
 * do /admin e no acompanhamento do /vender. A cessão `ENVIADA_DOCUSIGN` (DS2)
 * é o que liga o estado; sem ela, nada muda.
 */

function lead(cessaoStatus: string | null) {
  return {
    id: 'lead-1',
    nome: 'Cedente Teste',
    email: 'c@teste.test',
    status: 'OFERTA_ACEITA',
    criadoEm: '2026-11-11T00:00:00.000Z',
    ofertas: [
      {
        id: 'of-1',
        versao: 1,
        tipoBem: 'IMOVEL',
        valorCarta: '500.00',
        valorLiquidoVendedor: '400.00',
        desagioAquisicao: '0.2',
        administradora: 'Admin',
        status: 'ACEITA',
        validade: '2026-11-20T00:00:00.000Z',
        cessao: cessaoStatus
          ? { id: 'ces-1', status: cessaoStatus, onChainTxHash: null, pagamento: null, cota: null }
          : null,
      },
    ],
  };
}

describe('DS5 — /admin', () => {
  it('ENVIADA_DOCUSIGN: "Aguardando assinatura", sem botão de Pix', () => {
    const html = renderToStaticMarkup(<VendedorPipeline leads={[lead('ENVIADA_DOCUSIGN')]} />);
    expect(html).toContain('Aguardando assinatura');
    expect(html).toContain('data-testid="cessao-aguardando-assinatura"');
    expect(html).not.toContain('Executar Pix simulado');
  });

  it('ASSINADA: segue para a confirmação do titular (sem Pix avulso) e não há aviso', () => {
    const html = renderToStaticMarkup(<VendedorPipeline leads={[lead('ASSINADA')]} />);
    expect(html).toContain('Confirmar titular do laudo');
    expect(html).not.toContain('Executar Pix simulado');
    expect(html).not.toContain('cessao-aguardando-assinatura');
    expect(html).not.toContain('Aguardando assinatura');
  });
});

describe('DS5 — /vender/acompanhar', () => {
  const data = (aguardando: boolean): AcompanharData => ({
    leadId: 'lead-1',
    cedenteNome: 'Cedente Teste',
    status: 'OFERTA_ACEITA',
    etapaAtual: 4,
    contextoDescricao: 'Texto genérico da cessão.',
    ofertaId: 'of-1',
    oferta: null,
    cessaoId: 'ces-1',
    consentTx: null,
    cessaoTx: null,
    pixTx: null,
    temCota: false,
    aguardandoAssinatura: aguardando,
  });

  it('aparece na etapa de cessão quando a cessão foi enviada para assinatura', () => {
    const html = renderToStaticMarkup(<AcompanharView data={data(true)} />);
    expect(html).toContain('data-testid="aguardando-assinatura"');
    expect(html).toContain('Aguardando assinatura');
    expect(html).toContain('foi enviado para a sua assinatura');
    expect(html).not.toContain('Texto genérico da cessão.');
    expect(html).not.toContain('Assinar com e-CPF via DocuSign');
  });

  it('sem cessão enviada: tela como antes', () => {
    const html = renderToStaticMarkup(<AcompanharView data={data(false)} />);
    expect(html).not.toContain('aguardando-assinatura');
    expect(html).toContain('Texto genérico da cessão.');
    expect(html).toContain('Assinar com e-CPF via DocuSign');
  });
});
