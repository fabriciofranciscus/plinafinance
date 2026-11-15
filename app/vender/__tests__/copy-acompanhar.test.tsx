import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';
import { LeadVendedorStatus } from '@prisma/client';
import { ETAPAS_VENDER, contextoDoStatus } from '@/lib/vender/etapas';

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
    // Solicitação encerrada: canal declarado (Norma/Consuelo, 15/11 00:52), não "responda o e-mail".
    const encerrada = JSON.stringify(contextoDoStatus('PERDIDO'));
    expect(encerrada).toContain('fale com a equipe em contato@plina.finance informando o número do seu pedido.');
    expect(encerrada).not.toMatch(/responda o último/i);
    expect(JSON.stringify(contextoDoStatus('OFERTA_ENVIADA'))).toContain('Proposta enviada');
    expect(JSON.stringify(contextoDoStatus('OFERTA_ENVIADA'))).toContain('Para aceitar, use o botão Aceitar nesta página.');
    expect(JSON.stringify(contextoDoStatus('DOCS_RECEBIDOS'))).toContain('para gerar a proposta.');
  });
});

describe('estados do acompanhamento do cedente (achados A-14, A-15, A-16 da Vera)', () => {
  const render = (over: Partial<AcompanharData>) => renderToStaticMarkup(<AcompanharView data={{ ...data, ...over }} />);

  it('A-16: etapa da cessão não afirma "validade jurídica plena" (texto da Consuelo)', () => {
    const html = render({ etapaAtual: 4 });
    expect(html).not.toContain('Validade jurídica plena');
    expect(html).toContain('Hash do documento registrado em rede de testes. A validade da cessão depende da anuência da administradora e dos instrumentos jurídicos.');
  });

  it('A-14: Pix pago e cota NÃO incorporada: não afirma incorporação nem mostra o diagrama até o token', () => {
    const html = render({ etapaAtual: 5, temCota: false });
    expect(html).toContain('data-testid="cota-nao-incorporada"');
    expect(html).toContain('Pagamento simulado registrado. A incorporação da cota ao pool de demonstração ainda não aconteceu.');
    expect(html).not.toContain('Cota incorporada ao pool');
    expect(html).not.toContain('Token de demonstração · Stellar testnet');
  });

  it('A-14: com a cota incorporada (temCota), mostra a frase e o diagrama', () => {
    const html = render({ etapaAtual: 5, temCota: true });
    expect(html).toContain('data-testid="cota-incorporada"');
    expect(html).toContain('Cota incorporada ao pool de demonstração · tokens de demonstração emitidos na Stellar testnet.');
    expect(html).toContain('Token de demonstração · Stellar testnet');
  });

  it('A-15: fluxo concluído (etapaAtual 6) mostra "Etapa atual" na última etapa, não "Pré-visualização"', () => {
    const html = render({ etapaAtual: 6, temCota: true });
    expect(html).toContain('Etapa atual');
    expect(html).not.toContain('Pré-visualização');
  });

  it('A-15: cessão ainda não assinada mostra o aviso do link de e-mail; já assinada (etapa além da cessão) não repete', () => {
    expect(render({ etapaAtual: 4 })).toContain('data-testid="assinatura-por-email"');
  });
});

describe('vocabulário dos estados (Consuelo, item 11)', () => {
  const titulos = Object.values(LeadVendedorStatus).map((st) => contextoDoStatus(st).titulo);
  it('títulos novos: análise da cota, proposta, pagamento simulado e concluído com qualificador', () => {
    expect(contextoDoStatus('CONTATADO').titulo).toBe('Análise da cota em andamento');
    expect(contextoDoStatus('OFERTA_ENVIADA').titulo).toBe('Proposta enviada');
    expect(contextoDoStatus('OFERTA_ACEITA').titulo).toBe('Proposta aceita');
    expect(contextoDoStatus('CESSAO_ASSINADA').titulo).toBe('Cessão assinada (demonstração)');
    expect(contextoDoStatus('PIX_EXECUTADO').titulo).toBe('Pagamento simulado enviado');
    expect(contextoDoStatus('COTA_INCORPORADA').titulo).toBe('Concluído (simulação na rede de testes)');
  });
  it('nenhum título com "firme", "jurídica" nem "Pix enviado"', () => {
    expect(titulos.join(' | ')).not.toMatch(/firme|jurídica|Pix enviado|Oferta/i);
  });
  it('descrições de oferta usam "proposta"', () => {
    expect(contextoDoStatus('OFERTA_ENVIADA').descricao).toContain('Sua proposta está disponível');
    expect(contextoDoStatus('OFERTA_ACEITA').descricao).toContain('Tudo certo com a proposta.');
  });
  it('descrições finais da Norma (seção H): sem prazo, sem "jurídica", sem "tokenizado", "Pix recebido" virou "Pagamento recebido"', () => {
    expect(ETAPAS_VENDER[2]).toBe('Análise da cota');
    expect(ETAPAS_VENDER[3]).toBe('Proposta de preço');
    expect(ETAPAS_VENDER[5]).toBe('Pagamento enviado'); // nunca "recebido": só sabemos o que o parceiro informa (Consuelo)
    expect(contextoDoStatus('NOVO').descricao).toBe('Sua cota entrou na fila da nossa mesa. Iniciamos a análise da cota e dos documentos. Avisamos por e-mail a cada avanço.');
    expect(contextoDoStatus('CESSAO_ASSINADA').descricao).toContain('O pagamento do valor líquido é feito depois da cessão assinada. Não prometemos prazo.');
    expect(contextoDoStatus('COTA_INCORPORADA').descricao).toBe('Pagamento simulado enviado e cota incorporada ao pool (simulação na rede de testes).');
    const todas = Object.values(LeadVendedorStatus).map((st) => JSON.stringify(contextoDoStatus(st))).join(' ');
    expect(todas).not.toMatch(/48h|em até|jurídica|tokenizad|Pix recebido|Em breve|garantido|recebido e cota/i);
    expect(ETAPAS_VENDER.join(' ')).not.toMatch(/jurídica|Pix|recebido|Oferta/i);
  });
});
