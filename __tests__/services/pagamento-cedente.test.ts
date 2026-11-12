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
}));

import { PagamentoCedenteError, fecharPagamento, pagarCedenteDaCessao } from '@/lib/services/pagamento-cedente';
import type { PixProvider } from '@/lib/integrations/psp/types';

const SHA = 'b'.repeat(64);
const TX = 'a'.repeat(64);
const D = (v: string) => new Prisma.Decimal(v);
const prov = (nome: 'ASAAS' | 'SIMULADO') => ({ nome }) as unknown as PixProvider;
const IN = { cessaoId: 'cessao_1', chavePix: 'maria@example.com', tipoChave: 'EMAIL' as const, operador: 'admin-panel' };

const comprovada = (over: Record<string, unknown> = {}) => ({
  cessaoId: 'cessao_1', status: 'COMPROVADA', provedor: 'ASAAS', valor: D('1234.50'), providerId: 'tra_1', e2eId: 'E2E1',
  comprovanteSha256: SHA, ancoraTxHash: TX, comprovantePath: 'comprovantes-psp/cessao_1.json', ...over,
});

beforeEach(() => {
  process.env.PIX_MAX_BRL = '50000';
  m.rede.v = 'TESTNET';
  Object.values(m).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockReset());
  m.cessao.mockResolvedValue({
    id: 'cessao_1', status: 'ASSINADA', ofertaId: 'of_1',
    oferta: { valorLiquidoVendedor: D('1234.50'), leadVendedorId: 'lead_1' }, pagamento: null,
  });
  m.transf.mockResolvedValue(comprovada());
  m.pagamentoFind.mockResolvedValue(null);
  m.pagamentoUpsert.mockResolvedValue({ id: 'pag_1' });
  m.pagar.mockResolvedValue({ status: 'COMPROVADA', sha256: SHA, txHash: TX, transferenciaId: 'tra_1' });
});

describe('pagarCedenteDaCessao', () => {
  it('valor = oferta da cessão (2 casas), nunca o do chamador; COMPROVADA grava Pagamento PIX_REAL, lead e EventoAudit com payloadHash = SHA-256 do comprovante', async () => {
    const r = await pagarCedenteDaCessao({ ...IN, valor: '99999.00' } as never, { provider: prov('ASAAS') });
    expect(r).toEqual({ status: 'COMPROVADA', pagamentoId: 'pag_1', sha256: SHA, txHash: TX });
    expect(m.pagar.mock.calls[0][0]).toEqual({ cessaoId: 'cessao_1', valor: '1234.50', chavePix: IN.chavePix, tipoChave: 'EMAIL' });
    expect(m.pagamentoUpsert.mock.calls[0][0].create).toMatchObject({ metodo: 'PIX_REAL', onChainTxHash: TX, status: 'EXECUTADO', comprovanteUrl: 'comprovantes-psp/cessao_1.json' });
    expect(m.leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead_1' }, data: { status: 'PIX_EXECUTADO' } });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PIX_REAL_EXECUTADO', payloadHash: SHA, stellarTxHash: TX, cessaoId: 'cessao_1', operador: 'admin-panel' });
    expect(audit.payloadHash).toBe(audit.payloadJson.comprovanteSha256); // payloadHash = memo = SHA-256 do comprovante
    expect(JSON.stringify(audit)).not.toMatch(/maria|example\.com|chavePix/i); // sem PII nem chave Pix
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
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'PENDENTE', oferta: { valorLiquidoVendedor: D('1') }, pagamento: null });
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'ASSINADA', oferta: { valorLiquidoVendedor: D('1') }, pagamento: { status: 'EXECUTADO' } });
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
