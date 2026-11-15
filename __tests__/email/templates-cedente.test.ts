import { describe, expect, it } from 'vitest';
import { renderCedenteEmail } from '@/lib/email/templates-cedente';

describe('e-mail do cedente — texto da proposta (Norma/Consuelo, 15/11)', () => {
  const r = renderCedenteEmail('oferta', { leadId: 'lead_1', nome: 'Ana', valorLiquido: 'R$ 100,00' });

  it('título "Proposta disponível" e corpo com "proposta" (não "oferta firme") no html e no texto', () => {
    expect(r.html).toContain('Proposta disponível');
    expect(r.text).toContain('Preparamos uma proposta para a sua cota. Confira os valores e acompanhe o andamento pelo link abaixo.');
    expect(r.html).toContain('Preparamos uma proposta para a sua cota.');
    expect(`${r.text}${r.html}`).not.toMatch(/oferta firme|Oferta firme/);
  });

  it('o link de acompanhamento e os valores seguem no corpo', () => {
    expect(r.text).toContain('/vender/acompanhar/lead_1');
    expect(r.text).toContain('Valor líquido: R$ 100,00');
  });

  it('os demais e-mails não mudaram (cessão, pix e concluído)', () => {
    expect(renderCedenteEmail('cessao', { leadId: 'l' }).html).toContain('Cessão assinada e registrada');
    expect(renderCedenteEmail('pix', { leadId: 'l' }).html).toContain('Pagamento enviado');
  });
});
