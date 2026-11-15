import { describe, expect, it } from 'vitest';
import { linhaAndamento, proximaAcao } from '@/lib/me/proxima-acao';
import type { PosicaoResumo, ResumoDaConta, SolicitacaoResumo } from '@/lib/me/tipos';

const sol = (over: Partial<SolicitacaoResumo> = {}): SolicitacaoResumo => ({
  id: 'cmlead0000a1b2c3', status: 'NOVO', etapa: 2, tipoBem: 'IMOVEL', valorCarta: '150000.00',
  valorLiquido: null, ofertaValidade: null, cessaoStatus: null, ...over,
});
const resumo = (over: Partial<ResumoDaConta> = {}): ResumoDaConta => ({
  nome: null, papeis: [], posicao: null, solicitacoes: [], operacoesPendentes: [], ...over,
});
const posicao = (tokens: string): PosicaoResumo => ({ tokens, navPorToken: '1.0000', valorPeloNav: '1250.00', navFonte: 'ledger', snapshotEm: null, snapshotTxHash: null });

describe('proximaAcao (spec §2.3): uma ação, a primeira que valer', () => {
  it('1: proposta aguardando resposta, a de validade mais próxima', () => {
    const a = proximaAcao(resumo({ solicitacoes: [
      sol({ id: 'x000000aaaaaa', status: 'OFERTA_ENVIADA', etapa: 3, ofertaValidade: '2026-11-20T12:00:00Z' }),
      sol({ id: 'x000000bbbbbb', status: 'OFERTA_ENVIADA', etapa: 3, ofertaValidade: '2026-11-17T12:00:00Z' }),
    ] }));
    expect(a.caso).toBe(1);
    expect(a.titulo).toBe('Responder à proposta da solicitação #BBBBBB');
    expect(a).toMatchObject({ href: '/vender/acompanhar/x000000bbbbbb', botao: 'Ver proposta', escuro: true });
  });
  it('2: cessão enviada para assinatura', () => {
    const a = proximaAcao(resumo({ solicitacoes: [sol({ status: 'OFERTA_ACEITA', etapa: 4, cessaoStatus: 'ENVIADA_DOCUSIGN' })] }));
    expect(a.caso).toBe(2);
    expect((a as { apoio: string }).apoio).toContain('Verifique a caixa de spam.');
  });
  it('3: documentos solicitados', () => {
    expect(proximaAcao(resumo({ solicitacoes: [sol({ status: 'DOCS_SOLICITADOS' })] })).caso).toBe(3);
  });
  it('4: operação de entrada/saída pendente leva a /investir ou /sacar, com Pix simulado', () => {
    const a = proximaAcao(resumo({ operacoesPendentes: [{ tipo: 'saida', valor: 'R$ 200,00', situacao: 'em_conferencia', continuarEm: '/sacar' }], posicao: posicao('10') }));
    expect(a).toMatchObject({ caso: 4, titulo: 'Concluir a saída do pool', href: '/sacar' });
    expect((a as { apoio: string }).apoio).toContain('Pix simulado, rede de testes');
  });
  it('prioridade: proposta antes de assinatura antes de documentos antes de operação', () => {
    const r = resumo({
      solicitacoes: [sol({ id: 'd', status: 'DOCS_SOLICITADOS' }), sol({ id: 'a', status: 'OFERTA_ACEITA', etapa: 4, cessaoStatus: 'ENVIADA_DOCUSIGN' })],
      operacoesPendentes: [{ tipo: 'entrada', valor: 'R$ 1,00', situacao: 'em_conferencia', continuarEm: '/investir' }],
    });
    expect(proximaAcao(r).caso).toBe(2);
  });
  it('5: nada pendente com algo andando com a equipe: bloco claro e sem botão', () => {
    const a = proximaAcao(resumo({ solicitacoes: [sol({ status: 'DOCS_RECEBIDOS', etapa: 3 })] }));
    expect(a).toMatchObject({ caso: 5, escuro: false, titulo: 'Nenhuma ação sua agora' });
    expect('botao' in a).toBe(false);
  });
  it('6: nada pendente, com saldo', () => {
    expect(proximaAcao(resumo({ posicao: posicao('1250.0000') })).caso).toBe(6);
  });
  it('7: conta nova (sem saldo nem solicitação): dois botões', () => {
    const a = proximaAcao(resumo({ posicao: posicao('0.0000') }));
    expect(a).toMatchObject({ caso: 7, dois: true });
  });
  it('solicitação encerrada ou concluída nunca gera ação nem conta como "andando"', () => {
    expect(proximaAcao(resumo({ solicitacoes: [sol({ status: 'PERDIDO', etapa: -1 }), sol({ id: 'q', status: 'COTA_INCORPORADA', etapa: 6 })] })).caso).toBe(7);
  });
  it('KYC pendente: a ação é concluir a verificação', () => {
    const a = proximaAcao(resumo({ papeis: ['CEDENTE'], bloqueio: { motivo: 'kyc_pendente' }, solicitacoes: [sol({ status: 'OFERTA_ENVIADA', etapa: 3 })] }));
    expect(a).toMatchObject({ caso: 'bloqueio', href: '/vender' });
    expect(proximaAcao(resumo({ papeis: ['INVESTIDOR'], bloqueio: { motivo: 'kyc_pendente' } }))).toMatchObject({ caso: 'bloqueio', href: '/investir' });
    expect(proximaAcao(resumo({ bloqueio: { motivo: 'kyc_pendente' } }))).toMatchObject({ caso: 'bloqueio', href: '/investir' });
  });
  it('conta suspensa: sem botão, bloco claro, fala com a equipe; vence qualquer outra ação', () => {
    const a = proximaAcao(resumo({ bloqueio: { motivo: 'conta_suspensa' }, solicitacoes: [sol({ status: 'OFERTA_ENVIADA', etapa: 3 })] }));
    expect(a).toMatchObject({ caso: 'suspensa', titulo: 'Sua conta está com restrição', escuro: false });
    expect('botao' in a).toBe(false);
  });
});

describe('linhaAndamento (spec §2.4)', () => {
  it('etapa N de 6 e quem age, por status', () => {
    expect(linhaAndamento(sol({ status: 'NOVO', etapa: 2 }))).toEqual({ etapa: 'Etapa 3 de 6 · Validação', quemAge: 'Com a equipe · em validação' });
    expect(linhaAndamento(sol({ status: 'DOCS_SOLICITADOS' })).quemAge).toBe('Aguardando seus documentos');
    expect(linhaAndamento(sol({ status: 'OFERTA_ACEITA', etapa: 4, cessaoStatus: 'ENVIADA_DOCUSIGN' })).quemAge).toBe('Aguardando sua assinatura');
    expect(linhaAndamento(sol({ status: 'OFERTA_ACEITA', etapa: 4, cessaoStatus: 'PENDENTE' })).quemAge).toBe('Com a equipe · preparando a cessão');
    expect(linhaAndamento(sol({ status: 'CESSAO_ASSINADA', etapa: 5 }))).toEqual({ etapa: 'Etapa 6 de 6 · Pix', quemAge: 'Com a equipe · Pix sem prazo garantido' });
    expect(linhaAndamento(sol({ status: 'PIX_EXECUTADO', etapa: 6 })).quemAge).toBe('Pix enviado · cota em incorporação');
  });
  it('não promete prazo nem usa "oferta firme"', () => {
    const todos = (['NOVO', 'DOCS_SOLICITADOS', 'DOCS_RECEBIDOS', 'OFERTA_ENVIADA', 'OFERTA_ACEITA', 'CESSAO_ASSINADA', 'PIX_EXECUTADO'] as const)
      .map((st) => JSON.stringify(linhaAndamento(sol({ status: st, etapa: 3 })))).join(' ');
    expect(todos).not.toMatch(/oferta firme|em até|48/i);
  });
});
