import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  cessao: vi.fn(),
  transf: vi.fn(),
  pagamentoFind: vi.fn(),
  pagamentoUpsert: vi.fn(),
  leadUpdate: vi.fn(),
  auditCreate: vi.fn(),
  pagar: vi.fn(),
  reabrir: vi.fn(),
  ordem: [] as string[],
  rede: { v: 'TESTNET' },
}));

vi.mock('@/lib/db', () => {
  const tx = {
    pagamento: { findUnique: m.pagamentoFind, upsert: m.pagamentoUpsert },
    leadVendedor: { update: m.leadUpdate },
    eventoAudit: { create: m.auditCreate },
  };
  return {
    db: {
      cessao: { findUnique: m.cessao },
      transferenciaPix: { findUnique: m.transf },
      eventoAudit: { create: m.auditCreate },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/stellar/config', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/config')>()),
  get STELLAR_NETWORK() { return m.rede.v; },
}));
vi.mock('@/lib/services/liquidacao-cedente', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/liquidacao-cedente')>()),
  pagarTitular: m.pagar,
  reabrirTransferencia: m.reabrir,
}));

import { PagamentoCedenteError, fecharPagamento, pagarCedenteDaCessao, reabrirPagamentoCedente } from '@/lib/services/pagamento-cedente';
import type { PixProvider } from '@/lib/integrations/psp/types';

const SHA = 'b'.repeat(64);
const TX = 'a'.repeat(64);
const D = (v: string) => new Prisma.Decimal(v);
const prov = (nome: 'ASAAS' | 'SIMULADO') => ({ nome }) as unknown as PixProvider;
const CPF_CEDENTE = '52998224725'; // CPF sintético com dígitos verificadores válidos
const IN = { cessaoId: 'cessao_1', operador: 'admin-panel' };
const lead = (over: Record<string, unknown> = {}) => ({ cpf: CPF_CEDENTE, pessoa: null, ...over });

const comprovada = (over: Record<string, unknown> = {}) => ({
  cessaoId: 'cessao_1', status: 'COMPROVADA', provedor: 'ASAAS', valor: D('1234.50'), providerId: 'tra_1', e2eId: 'E2E1',
  comprovanteSha256: SHA, ancoraTxHash: TX, comprovantePath: 'comprovantes-psp/cessao_1.json', ...over,
});

beforeEach(() => {
  process.env.PIX_MAX_BRL = '50000';
  m.rede.v = 'TESTNET';
  Object.values(m).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockReset());
  m.ordem.length = 0;
  m.cessao.mockResolvedValue({
    id: 'cessao_1', status: 'ASSINADA', ofertaId: 'of_1',
    oferta: { valorLiquidoVendedor: D('1234.50'), leadVendedorId: 'lead_1', leadVendedor: lead() }, pagamento: null,
  });
  m.transf.mockResolvedValue(comprovada());
  m.pagamentoFind.mockResolvedValue(null);
  m.pagamentoUpsert.mockResolvedValue({ id: 'pag_1' });
  m.pagar.mockResolvedValue({ status: 'COMPROVADA', sha256: SHA, txHash: TX, transferenciaId: 'tra_1' });
});

describe('pagarCedenteDaCessao', () => {
  it('valor = oferta da cessão (2 casas), nunca o do chamador; COMPROVADA grava Pagamento PIX_REAL, lead e EventoAudit com payloadHash = SHA-256 do comprovante', async () => {
    const r = await pagarCedenteDaCessao({ ...IN, valor: '99999.00', chavePix: 'outra@pessoa.com', tipoChave: 'EMAIL' } as never, { provider: prov('ASAAS') });
    expect(r).toEqual({ status: 'COMPROVADA', pagamentoId: 'pag_1', sha256: SHA, txHash: TX });
    // o destino é o CPF do cedente da cessão; o que o chamador tentou passar (valor, chave de outro tipo) é ignorado
    expect(m.pagar.mock.calls[0][0]).toEqual({ cessaoId: 'cessao_1', valor: '1234.50', chavePix: CPF_CEDENTE, tipoChave: 'CPF' });
    expect(m.pagamentoUpsert.mock.calls[0][0].create).toMatchObject({ metodo: 'PIX_REAL', onChainTxHash: TX, status: 'EXECUTADO', comprovanteUrl: 'comprovantes-psp/cessao_1.json' });
    expect(m.leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead_1' }, data: { status: 'PIX_EXECUTADO' } });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PIX_REAL_EXECUTADO', payloadHash: SHA, stellarTxHash: TX, cessaoId: 'cessao_1', operador: 'admin-panel' });
    expect(audit.payloadHash).toBe(audit.payloadJson.comprovanteSha256); // payloadHash = memo = SHA-256 do comprovante
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${CPF_CEDENTE}|chavePix`, 'i')); // sem CPF nem chave Pix
  });

  it('provedor SIMULADO (testnet) grava metodo PIX_SIMULADO', async () => {
    m.transf.mockResolvedValue(comprovada({ provedor: 'SIMULADO' }));
    await pagarCedenteDaCessao(IN, { provider: prov('SIMULADO') });
    expect(m.pagamentoUpsert.mock.calls[0][0].create.metodo).toBe('PIX_SIMULADO');
  });

  it('SIMULADO com STELLAR_NETWORK=PUBLIC conta como NÃO pago: recusa, nada vai ao PSP e nada é gravado', async () => {
    m.rede.v = 'PUBLIC';
    await expect(pagarCedenteDaCessao(IN, { provider: prov('SIMULADO') })).rejects.toMatchObject({ code: 'SIMULADO_EM_MAINNET' });
    expect(m.pagar).not.toHaveBeenCalled();
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['sem PIX_MAX_BRL', undefined],
    ['PIX_MAX_BRL inválido', 'abc'],
    ['PIX_MAX_BRL zero', '0'],
    ['PIX_MAX_BRL negativo', '-5'],
  ])('%s: recusa (fail-closed), sem claim nem PSP', async (_n, valor) => {
    if (valor === undefined) delete process.env.PIX_MAX_BRL; else process.env.PIX_MAX_BRL = valor;
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TETO_NAO_CONFIGURADO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });

  it('valor da oferta acima do teto: ACIMA_DO_TETO, sem PSP; exatamente no teto passa', async () => {
    process.env.PIX_MAX_BRL = '1000';
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'ACIMA_DO_TETO' });
    expect(m.pagar).not.toHaveBeenCalled();
    process.env.PIX_MAX_BRL = '1234.50';
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).resolves.toMatchObject({ status: 'COMPROVADA' });
  });

  it('cessão inexistente, não assinada ou já paga: recusa sem PSP', async () => {
    m.cessao.mockResolvedValueOnce(null);
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CESSAO_NAO_ENCONTRADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'PENDENTE', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: null });
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'ASSINADA', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: { status: 'EXECUTADO' } });
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'PAGAMENTO_JA_EXECUTADO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });

  it.each(['PROCESSANDO', 'INCERTO', 'FALHOU'] as const)('porta devolve %s: NÃO grava Pagamento, lead nem EventoAudit', async (status) => {
    m.pagar.mockResolvedValue({ status, sha256: undefined, txHash: undefined });
    const r = await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect(r.status).toBe(status);
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
    expect(m.leadUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('VALOR_DIVERGE da porta propaga (sem pagar e sem gravar)', async () => {
    const { LiquidacaoCedenteError } = await import('@/lib/services/liquidacao-cedente');
    m.pagar.mockRejectedValue(new LiquidacaoCedenteError('VALOR_DIVERGE'));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'VALOR_DIVERGE' });
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
  });
});

describe('P2 (Argus/Atlas): o destino é o CPF do cedente da cessão, nunca o do chamador', () => {
  const cessaoCom = (leadVendedor: unknown) => ({
    id: 'cessao_1', status: 'ASSINADA', ofertaId: 'of_1',
    oferta: { valorLiquidoVendedor: D('1234.50'), leadVendedorId: 'lead_1', leadVendedor }, pagamento: null,
  });
  it.each([
    ['sem CPF no cadastro', lead({ cpf: null })],
    ['CPF inválido (dígito verificador)', lead({ cpf: '52998224726' })],
    ['CPF de dígitos repetidos', lead({ cpf: '11111111111' })],
    ['sem lead', null],
  ])('%s → CEDENTE_SEM_DOCUMENTO, nada vai ao PSP', async (_n, l) => {
    m.cessao.mockResolvedValueOnce(cessaoCom(l));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('cedente PJ: documento de 14 dígitos válido vira chave do tipo CNPJ (e CNPJ inválido é recusado)', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '11.222.333/0001-81' })));
    await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect(m.pagar.mock.calls[0][0]).toMatchObject({ chavePix: '11222333000181', tipoChave: 'CNPJ' });
    m.pagar.mockClear();
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '11222333000180' })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('documento com tamanho que não é CPF nem CNPJ (ex.: 12 dígitos) → CEDENTE_SEM_DOCUMENTO, sem PSP', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '123456789012' })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('CPF do lead com máscara é normalizado para dígitos', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '529.982.247-25' })));
    await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect((m.pagar.mock.calls[0] as unknown as [Record<string, string>])[0].chavePix).toBe(CPF_CEDENTE);
  });
  it('CPF da conta (Pessoa) diferente do CPF do lead → TITULAR_DIVERGE, sem pagar; igual passa', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: { cpfNormalizado: '11144477735' } })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TITULAR_DIVERGE' });
    expect(m.pagar).not.toHaveBeenCalled();
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: { cpfNormalizado: CPF_CEDENTE } })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).resolves.toMatchObject({ status: 'COMPROVADA' });
  });
});

describe('reabrirPagamentoCedente — ação de admin AUDITADA (decisão do Atlas, F-E12-1)', () => {
  const falhou = (over: Record<string, unknown> = {}) => comprovada({
    status: 'FALHOU', tentativa: 1, idempotencyKey: 'pix-cedente:cessao_1', motivoFalha: 'PSP_RECUSOU', providerId: null,
    comprovanteSha256: null, ancoraTxHash: null, destinoMascarado: 'CPF ***4725', ...over,
  });
  beforeEach(() => {
    m.transf.mockResolvedValue(falhou());
    m.auditCreate.mockImplementation(async () => { m.ordem.push('audit'); return {}; });
    m.reabrir.mockImplementation(async () => { m.ordem.push('reabrir'); return { status: 'PROCESSANDO' }; });
  });

  it('FALHOU confirmado: grava EventoAudit PIX_REAL_REABERTO ANTES do novo envio e reabre com o MESMO destino (CPF do cadastro) e o valor da oferta', async () => {
    const r = await reabrirPagamentoCedente({ ...IN, chavePix: 'outra@pessoa.com', valor: '1.00' } as never, { provider: prov('ASAAS') });
    expect(r.status).toBe('PROCESSANDO');
    expect(m.ordem).toEqual(['audit', 'reabrir']);
    expect(m.reabrir.mock.calls[0][0]).toEqual({ cessaoId: 'cessao_1', valor: '1234.50', chavePix: CPF_CEDENTE, tipoChave: 'CPF', operador: 'admin-panel' });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PIX_REAL_REABERTO', operador: 'admin-panel', cessaoId: 'cessao_1', leadVendedorId: 'lead_1' });
    expect(audit.payloadJson).toMatchObject({ tentativaAnterior: 1, tentativaNova: 2, motivoAnterior: 'PSP_RECUSOU', idempotencyKeyAnterior: 'pix-cedente:cessao_1' });
    expect(JSON.stringify(audit)).not.toContain(CPF_CEDENTE); // sem CPF na auditoria
  });

  it('se a reabertura já concluiu (COMPROVADA), fecha o pagamento (Pagamento/lead/EventoAudit de execução)', async () => {
    m.reabrir.mockResolvedValue({ status: 'COMPROVADA', sha256: SHA, txHash: TX });
    m.transf.mockReset().mockResolvedValueOnce(falhou()).mockResolvedValue(comprovada()); // 1ª leitura FALHOU; depois da reabertura, COMPROVADA
    const r = await reabrirPagamentoCedente(IN, { provider: prov('ASAAS') });
    expect(r).toMatchObject({ status: 'COMPROVADA', pagamentoId: 'pag_1' });
    expect(m.pagamentoUpsert).toHaveBeenCalledOnce();
  });

  it.each(['INCERTO', 'PROCESSANDO', 'ENVIANDO', 'COMPROVADA'] as const)('estado %s NÃO reabre (o dinheiro pode ter saído): NAO_REABRIVEL, sem auditoria nem envio', async (status) => {
    m.transf.mockResolvedValue(falhou({ status }));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'NAO_REABRIVEL', causa: status });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
  });

  it('o destino do cadastro mudou desde a tentativa anterior: DESTINO_DIVERGE (destino diferente = pós-D30, dupla aprovação), sem auditoria nem envio', async () => {
    m.transf.mockResolvedValue(falhou({ destinoMascarado: 'CPF ***9999' }));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'DESTINO_DIVERGE' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
  });

  it('sem transferência registrada, cessão não assinada, já paga, sem CPF, acima do teto ou simulado em mainnet: recusa sem auditoria nem envio', async () => {
    m.transf.mockResolvedValueOnce(null);
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TRANSFERENCIA_NAO_ENCONTRADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'PENDENTE', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: null });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'ASSINADA', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: { status: 'EXECUTADO' } });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'PAGAMENTO_JA_EXECUTADO' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'ASSINADA', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead({ cpf: null }) }, pagamento: null });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    process.env.PIX_MAX_BRL = '10';
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'ACIMA_DO_TETO' });
    process.env.PIX_MAX_BRL = '50000';
    m.rede.v = 'PUBLIC';
    await expect(reabrirPagamentoCedente(IN, { provider: prov('SIMULADO') })).rejects.toMatchObject({ code: 'SIMULADO_EM_MAINNET' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
  });
});

describe('fecharPagamento', () => {
  it('idempotente: Pagamento já EXECUTADO não duplica Pagamento nem EventoAudit', async () => {
    m.pagamentoFind.mockResolvedValue({ id: 'pag_1', status: 'EXECUTADO' });
    expect(await fecharPagamento('cessao_1')).toEqual({ criado: false, pagamentoId: 'pag_1' });
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('só fecha transferência COMPROVADA com hash e âncora (senão erro, nada gravado)', async () => {
    for (const t of [null, comprovada({ status: 'PROCESSANDO' }), comprovada({ ancoraTxHash: null }), comprovada({ comprovanteSha256: null })]) {
      m.transf.mockResolvedValueOnce(t);
      await expect(fecharPagamento('cessao_1')).rejects.toBeInstanceOf(Error);
    }
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
    expect(PagamentoCedenteError).toBeDefined();
  });
  it('o operador do varredor é identificado no EventoAudit', async () => {
    await fecharPagamento('cessao_1');
    expect(m.auditCreate.mock.calls[0][0].data.operador).toBe('varredor-pix');
  });
});
