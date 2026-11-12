import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ cessao: vi.fn(), update: vi.fn(), audit: vi.fn(), transf: vi.fn() }));
vi.mock('@/lib/db', () => {
  const tx = { cessao: { update: m.update }, eventoAudit: { create: m.audit } };
  return {
    db: {
      cessao: { findUnique: m.cessao },
      transferenciaPix: { findUnique: m.transf },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { confirmarTitularDoLaudo, documentoValido, exigirTitularDoLaudo, hmacDoDocumento } from '@/lib/services/titular-laudo';

process.env.TITULAR_HMAC_SECRET = 's'.repeat(40); // também na coleta (as tabelas it.each calculam HMAC antes dos hooks)
const CPF = '52998224725';
const CNPJ = '11222333000181';
const pessoa = (over: Record<string, unknown> = {}) => ({ cpfNormalizado: CPF, kycAprovado: true, isSyntheticCpf: false, ...over });
const cessaoDb = (p: unknown = pessoa()) => ({ id: 'c1', oferta: { leadVendedorId: 'lead_1', leadVendedor: { pessoa: p } } });
const IN = { cessaoId: 'c1', situacao: 'TITULAR_UNICO' as const, atestado: true, operador: 'admin-panel' };

beforeEach(() => {
  process.env.TITULAR_HMAC_SECRET = 's'.repeat(40);
  m.cessao.mockReset().mockResolvedValue(cessaoDb());
  m.transf.mockReset().mockResolvedValue(null);
  m.update.mockReset().mockResolvedValue({});
  m.audit.mockReset().mockResolvedValue({});
});

describe('hmacDoDocumento', () => {
  it('determinístico, 64 hex, diferente por cessão e por segredo; nunca contém o documento', () => {
    const a = hmacDoDocumento('c1', CPF);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hmacDoDocumento('c1', CPF));
    expect(a).not.toBe(hmacDoDocumento('c2', CPF)); // o mesmo CPF em outra cessão não coincide
    expect(a).not.toContain(CPF);
    process.env.TITULAR_HMAC_SECRET = 'x'.repeat(40);
    expect(a).not.toBe(hmacDoDocumento('c1', CPF)); // sem o segredo não se reproduz
  });
  it.each([undefined, '', 'curto'])('segredo ausente/fraco (%s) → SEGREDO_NAO_CONFIGURADO', (v) => {
    if (v === undefined) delete process.env.TITULAR_HMAC_SECRET; else process.env.TITULAR_HMAC_SECRET = v;
    expect(() => hmacDoDocumento('c1', CPF)).toThrow(expect.objectContaining({ code: 'SEGREDO_NAO_CONFIGURADO' }));
  });
});

describe('documentoValido', () => {
  it.each([['529.982.247-25', CPF], ['11.222.333/0001-81', CNPJ]])('%s → só dígitos', (b, d) => expect(documentoValido(b)).toBe(d));
  it.each(['52998224726', '11222333000180', '123', '', '00000000000'])('%s → null', (b) => expect(documentoValido(b)).toBeNull());
});

describe('confirmarTitularDoLaudo — o operador ATESTA, o sistema lê o CPF do cadastro', () => {
  it('atestado + cadastro verificado: grava só o HMAC do CPF DO CADASTRO e a situação; o EventoAudit leva o HMAC e o atestado, nunca o CPF', async () => {
    expect(await confirmarTitularDoLaudo(IN)).toEqual({ situacao: 'TITULAR_UNICO', pagamentoAutomatico: true });
    const hmac = hmacDoDocumento('c1', CPF);
    expect(m.update.mock.calls[0][0].data).toEqual({ titularDocHmac: hmac, titularSituacao: 'TITULAR_UNICO' });
    const audit = m.audit.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'TITULAR_LAUDO_CONFIRMADO', operador: 'admin-panel', cessaoId: 'c1', leadVendedorId: 'lead_1' });
    expect(audit.payloadJson).toEqual({
      cessaoId: 'c1', situacao: 'TITULAR_UNICO', atestado: 'TITULAR_CONFIRMADO_IGUAL_AO_CPF_DO_CADASTRO', tipoDocumento: 'CPF', documentoHmac: hmac,
    });
    expect(JSON.stringify([m.update.mock.calls, audit])).not.toContain(CPF);
  });
  it.each([undefined, false, 'true', 1])('sem o atestado (%s) nada é gravado e não há como pagar', async (atestado) => {
    await expect(confirmarTitularDoLaudo({ ...IN, atestado: atestado as never })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    expect(m.cessao).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(['ESPOLIO', 'COTITULARIDADE', 'PROCURADOR'] as const)('%s fica registrado e NÃO libera pagamento automático', async (situacao) => {
    expect((await confirmarTitularDoLaudo({ ...IN, situacao })).pagamentoAutomatico).toBe(false);
  });
  it.each([
    ['situação desconhecida', { situacao: 'OUTRA' as never }],
    ['operador vazio', { operador: '' }],
    ['sem cessão', { cessaoId: '' }],
  ])('%s → ENTRADA_INVALIDA, nada gravado', async (_n, troca) => {
    await expect(confirmarTitularDoLaudo({ ...IN, ...troca })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([
    ['sem pessoa ligada ao lead', null],
    ['pessoa sem CPF', pessoa({ cpfNormalizado: null })],
    ['CPF inválido', pessoa({ cpfNormalizado: '52998224726' })],
    ['KYC não aprovado', pessoa({ kycAprovado: false })],
    ['CPF sintético', pessoa({ isSyntheticCpf: true })],
  ])('cadastro sem o que atestar (%s) → CEDENTE_SEM_DOCUMENTO, nada gravado', async (_n, p) => {
    m.cessao.mockResolvedValue(cessaoDb(p));
    await expect(confirmarTitularDoLaudo(IN)).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('cessão inexistente; pagamento já em curso (não muda depois); sem segredo → recusa sem tocar o banco', async () => {
    m.cessao.mockResolvedValueOnce(null);
    await expect(confirmarTitularDoLaudo(IN)).rejects.toMatchObject({ code: 'CESSAO_NAO_ENCONTRADA' });
    m.transf.mockResolvedValueOnce({ id: 't1' });
    await expect(confirmarTitularDoLaudo(IN)).rejects.toMatchObject({ code: 'PAGAMENTO_EM_CURSO' });
    delete process.env.TITULAR_HMAC_SECRET;
    m.cessao.mockClear();
    await expect(confirmarTitularDoLaudo(IN)).rejects.toMatchObject({ code: 'SEGREDO_NAO_CONFIGURADO' });
    expect(m.cessao).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it('o HMAC gravado bate com o que o pagamento recalcula do cadastro (e diverge se o CPF do cadastro mudar depois)', async () => {
    await confirmarTitularDoLaudo(IN);
    const gravado = m.update.mock.calls[0][0].data.titularDocHmac as string;
    const cessao = { id: 'c1', titularDocHmac: gravado, titularSituacao: 'TITULAR_UNICO' };
    expect(() => exigirTitularDoLaudo(cessao, CPF)).not.toThrow();
    expect(() => exigirTitularDoLaudo(cessao, '11144477735')).toThrow(expect.objectContaining({ code: 'TITULAR_DIVERGE_LAUDO' }));
  });
});

describe('exigirTitularDoLaudo', () => {
  const ok = { id: 'c1', titularDocHmac: hmacDoDocumento('c1', CPF), titularSituacao: 'TITULAR_UNICO' };
  it('confere → não lança', () => expect(() => exigirTitularDoLaudo(ok, CPF)).not.toThrow());
  it.each([
    ['documento diferente', ok, '11144477735', 'TITULAR_DIVERGE_LAUDO'],
    ['HMAC de outra cessão', { ...ok, id: 'c2' }, CPF, 'TITULAR_DIVERGE_LAUDO'],
    ['sem HMAC', { ...ok, titularDocHmac: null }, CPF, 'TITULAR_NAO_CONFIRMADO'],
    ['sem situação', { ...ok, titularSituacao: null }, CPF, 'TITULAR_NAO_CONFIRMADO'],
    ['espólio', { ...ok, titularSituacao: 'ESPOLIO' }, CPF, 'TRATAMENTO_MANUAL'],
  ])('%s → %s', (_n, cessao, doc, code) => {
    expect(() => exigirTitularDoLaudo(cessao as never, doc)).toThrow(expect.objectContaining({ code }));
  });
});
