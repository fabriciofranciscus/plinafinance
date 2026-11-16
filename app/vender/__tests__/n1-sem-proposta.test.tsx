import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => null }) }));

import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';
import { contextoDoStatus } from '@/lib/vender/etapas';

// AP-5, N1 e N7 (Norma, 16/11, sem jurídico).
const semProposta: AcompanharData = {
  leadId: 'lead-1', cedenteNome: 'Cedente Teste', status: 'CONTATADO', etapaAtual: 3,
  contextoDescricao: 'x', ofertaId: null, oferta: null, cessaoId: null,
  consentTx: null, cessaoTx: null, pixTx: null, temCota: false,
};

describe('N1: sem proposta, a tela diz o estado e não promete que ela vai chegar', () => {
  const html = renderToStaticMarkup(<AcompanharView data={semProposta} />);
  it('"Ainda não há proposta para esta solicitação."', () => {
    expect(html).toContain('Ainda não há proposta para esta solicitação.');
  });
  it('sai a promessa de chegada ("aparece aqui quando a mesa concluir a validação")', () => {
    expect(html).not.toMatch(/aparece aqui quando|será exibida|quando estiver disponível/);
  });
  it('o exemplo continua rotulado como ilustrativo, de rede de testes, e o aceite fica desabilitado', () => {
    expect(html).toContain('Exemplo ilustrativo');
    expect(html).toContain('simulação em rede de testes');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Aceitar proposta/);
  });
  it('a ausência vem ANTES do exemplo (o exemplo não é lido como resumo real)', () => {
    expect(html.indexOf('Ainda não há proposta para esta solicitação.')).toBeLessThan(html.indexOf('Exemplo ilustrativo'));
  });
  it('o título da etapa "Análise da cota em andamento" se mantém', () => {
    expect(contextoDoStatus('CONTATADO').titulo).toBe('Análise da cota em andamento');
  });
});

describe('N7: solicitação encerrada', () => {
  it('texto da Norma, com o contato e sem "responda o último e-mail"', () => {
    const c = contextoDoStatus('PERDIDO');
    expect(c.titulo).toBe('Solicitação encerrada');
    expect(c.descricao).toBe('Esta solicitação foi encerrada. Se acha que houve engano, fale com a equipe em contato@plina.finance informando o número do seu pedido.');
    expect(c.descricao).not.toMatch(/responda|último e-mail/i);
  });
});
