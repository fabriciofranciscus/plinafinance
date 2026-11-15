import { describe, expect, it } from 'vitest';
import { etapasDoLead, ordenarSolicitacoes } from '@/lib/admin/etapas-operador';
import type { CessaoAdmin, LeadAdmin } from '@/lib/admin/tipos';

const cessao = (o: Partial<CessaoAdmin> = {}): CessaoAdmin => ({ id: 'c1', status: 'PENDENTE', onChainTxHash: null, pagamento: null, cota: null, ...o });
const lead = (over: { lead?: Partial<LeadAdmin>; oferta?: Record<string, unknown> | null; cessao?: CessaoAdmin | null } = {}): LeadAdmin => ({
  id: 'cmlead00000a1b2c3', nome: 'Cedente Teste', email: 'c@exemplo.test', status: 'OFERTA_ACEITA', criadoEm: '2026-11-14T12:00:00Z',
  ofertas: over.oferta === null ? [] : [{
    id: 'o1', versao: 1, tipoBem: 'IMOVEL', valorCarta: '150000', valorLiquidoVendedor: '120000', desagioAquisicao: '0.2',
    administradora: 'Adm', status: 'ACEITA', validade: '2026-12-01T00:00:00Z',
    cessao: over.cessao === undefined ? null : over.cessao, ...(over.oferta ?? {}),
  }],
  ...(over.lead ?? {}),
});
const agora = (l: LeadAdmin, o = {}) => { const a = etapasDoLead(l, o); return { n: a.atual, acao: a.proximaAcao, dep: a.dependeDe, estado: a.estado }; };
const situacoes = (l: LeadAdmin) => etapasDoLead(l).etapas.map((e) => e.situacao[0]).join('');

describe('etapasDoLead (spec §4.4): uma etapa "agora", a primeira não feita', () => {
  it('1 sem oferta: gerar proposta', () => {
    expect(agora(lead({ oferta: null, lead: { status: 'DOCS_RECEBIDOS' } }))).toEqual({ n: 1, acao: 'Gerar proposta', dep: 'operador', estado: 'aberta' });
  });
  it('2 oferta enviada: aguardando o cedente (sem ação do operador)', () => {
    expect(agora(lead({ oferta: { status: 'ENVIADA' } }))).toEqual({ n: 2, acao: 'Aguardando o cedente', dep: 'cedente', estado: 'aberta' });
  });
  it('3 oferta aceita sem cessão: registrar cessão', () => {
    expect(agora(lead()).acao).toBe('Registrar cessão');
  });
  it('4 cessão pendente sem laudo: registrar laudo', () => {
    expect(agora(lead({ cessao: cessao({ laudoRegistrado: false }) }))).toMatchObject({ n: 4, acao: 'Registrar laudo' });
  });
  it('5 cessão pendente com laudo: enviar para assinatura', () => {
    expect(agora(lead({ cessao: cessao({ laudoRegistrado: true }) }))).toMatchObject({ n: 5, acao: 'Enviar para assinatura' });
  });
  it('6 enviada ao DocuSign: aguardando o cedente (depende do cedente)', () => {
    expect(agora(lead({ cessao: cessao({ status: 'ENVIADA_DOCUSIGN', laudoRegistrado: true }) }))).toMatchObject({ n: 6, acao: 'Aguardando assinatura do cedente', dep: 'cedente' });
  });
  it('7 assinada sem titular: confirmar titular', () => {
    expect(agora(lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true }) }))).toMatchObject({ n: 7, acao: 'Confirmar titular' });
  });
  it('8 titular único sem anuência: registrar anuência (antes do pagamento)', () => {
    expect(agora(lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', laudoHash: 'a' }) }))).toMatchObject({ n: 8, acao: 'Registrar anuência' });
  });
  it('9 com anuência: pagar cedente (Pix simulado fora da rede pública)', () => {
    const l = lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', anuenciaStatus: 'DECLARADA_PENDENTE' }) });
    expect(agora(l).acao).toBe('Pagar cedente (Pix simulado)');
    expect(agora(l, { redePublica: true }).acao).toBe('Pagar cedente (Pix)');
  });
  it('9 Pix em andamento: reconsultar, nunca novo pagamento; FALHOU: reabrir', () => {
    const base = { status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', anuenciaStatus: 'CONFIRMADA' };
    for (const px of ['ENVIANDO', 'PROCESSANDO', 'INCERTO']) {
      const a = etapasDoLead(lead({ cessao: cessao({ ...base, pixStatus: px }) }));
      expect([a.atual, a.proximaAcao, a.pagamento]).toEqual([9, 'Reconsultar pagamento', 'reconsultar']);
    }
    const f = etapasDoLead(lead({ cessao: cessao({ ...base, pixStatus: 'FALHOU' }) }));
    expect([f.atual, f.proximaAcao, f.pagamento]).toEqual([9, 'Reabrir pagamento', 'reabrir']);
  });
  it('10 Pix comprovado e pagamento executado: incorporar cota', () => {
    const l = lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', anuenciaStatus: 'CONFIRMADA', pixStatus: 'COMPROVADA', pagamento: { id: 'p', status: 'EXECUTADO', onChainTxHash: 'tx' } }) });
    expect(agora(l)).toMatchObject({ n: 10, acao: 'Incorporar cota', dep: 'operador' });
    expect(situacoes(l)).toBe('fffffffffa');
  });
  it('pagamento já executado mas SEM anuência: a anuência é a etapa "agora" (incorporar só depois)', () => {
    const l = lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', pixStatus: 'COMPROVADA', pagamento: { id: 'p', status: 'EXECUTADO', onChainTxHash: null } }) });
    expect(agora(l).n).toBe(8);
  });
});

describe('estados fora da linha reta', () => {
  it('concluída (cota existe): nenhuma etapa "agora", próxima ação "Concluída"', () => {
    const l = lead({ lead: { status: 'COTA_INCORPORADA' }, cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'TITULAR_UNICO', anuenciaStatus: 'CONFIRMADA', pixStatus: 'COMPROVADA', pagamento: { id: 'p', status: 'EXECUTADO', onChainTxHash: null }, cota: { id: 'cota1' } }) });
    const a = etapasDoLead(l);
    expect(a).toMatchObject({ estado: 'concluida', atual: null, proximaAcao: 'Concluída', dependeDe: 'ninguem' });
    expect(a.etapas.every((e) => e.situacao === 'feita')).toBe(true);
  });
  it('encerrada (PERDIDO): nenhuma etapa "agora", as feitas continuam visíveis', () => {
    const a = etapasDoLead(lead({ lead: { status: 'PERDIDO' }, oferta: { status: 'ENVIADA' } }));
    expect(a).toMatchObject({ estado: 'encerrada', atual: null, proximaAcao: 'Encerrada' });
    expect(a.etapas[0]!.situacao).toBe('feita');
  });
  it('titular diferente de titular único: etapa 7 feita, para, sem "agora", com a razão', () => {
    const a = etapasDoLead(lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, titularSituacao: 'ESPOLIO' }) }));
    expect(a).toMatchObject({ estado: 'manual', atual: null, proximaAcao: 'Tratamento manual', pausa: 'Fora do fluxo automático. Tratamento manual pela equipe.' });
    expect(a.etapas[6]!.situacao).toBe('feita');
    expect(a.etapas.slice(7).every((e) => e.situacao === 'futura')).toBe(true);
  });
  it('oferta recusada/expirada: sem "agora" e com a razão', () => {
    const a = etapasDoLead(lead({ oferta: { status: 'EXPIRADA' } , lead: { status: 'OFERTA_ENVIADA' } }));
    expect(a.atual).toBeNull();
    expect(a.pausa).toBe('Proposta expirada: não há ação nesta etapa.');
  });
});

describe('evidência e pré-condição por etapa', () => {
  it('etapas feitas guardam data e evidência reais; futuras só o rótulo e "depois da etapa N"', () => {
    const l = lead({ cessao: cessao({ status: 'ASSINADA', laudoRegistrado: true, laudoHash: 'h'.repeat(64), onChainTxHash: 'tx5c02', assinadaEm: '2026-11-15T04:40:00Z', laudoEm: '2026-11-15T03:20:00Z' }) });
    const e = etapasDoLead(l).etapas;
    expect(e[3]).toMatchObject({ situacao: 'feita', data: '2026-11-15T03:20:00Z', evidencia: { hash: 'h'.repeat(64) } });
    expect(e[5]).toMatchObject({ situacao: 'feita', evidencia: { tx: 'tx5c02' } });
    expect(e[1]!.data).toBeNull(); // sem data real (não inventar)
    expect(e[7]).toMatchObject({ situacao: 'futura', data: null, evidencia: null, depoisDe: 'depois da etapa 7' });
    expect(e[6]).toMatchObject({ situacao: 'agora', n: 7 });
  });
});

describe('ordenarSolicitacoes', () => {
  it('operador primeiro, depois aguardando cedente, depois concluídas/encerradas; mais antiga primeiro dentro do grupo', () => {
    const op = lead({ oferta: null, lead: { id: 'op', criadoEm: '2026-11-14T10:00:00Z' } });
    const op2 = lead({ oferta: null, lead: { id: 'op2', criadoEm: '2026-11-13T10:00:00Z' } });
    const ced = lead({ oferta: { status: 'ENVIADA' }, lead: { id: 'ced', criadoEm: '2026-11-12T10:00:00Z' } });
    const enc = lead({ lead: { id: 'enc', status: 'PERDIDO', criadoEm: '2026-11-11T10:00:00Z' } });
    expect(ordenarSolicitacoes([enc, ced, op, op2]).map((l) => l.id)).toEqual(['op2', 'op', 'ced', 'enc']);
  });
});
