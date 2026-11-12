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
  lock: vi.fn(),
  pagFind: vi.fn(),
  transfUpdate: vi.fn(),
  ordem: [] as string[],
  rede: { v: 'TESTNET' },
}));

vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: m.lock,
    pagamento: { findUnique: m.pagamentoFind, upsert: m.pagamentoUpsert },
    leadVendedor: { update: m.leadUpdate },
    eventoAudit: { create: m.auditCreate },
  };
  return {
    db: {
      cessao: { findUnique: m.cessao },
      pagamento: { findUnique: m.pagFind },
      transferenciaPix: { findUnique: m.transf, update: m.transfUpdate },
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

import { PagamentoCedenteError, fecharPagamento, pagarCedenteDaCessao, reabrirPagamentoCedente, situacaoPagamentoDoCedente } from '@/lib/services/pagamento-cedente';
import type { PixProvider } from '@/lib/integrations/psp/types';

const SHA = 'b'.repeat(64);
const TX = 'a'.repeat(64);
const D = (v: string) => new Prisma.Decimal(v);
const prov = (nome: 'ASAAS' | 'SIMULADO') => ({ nome }) as unknown as PixProvider;
const CPF_CEDENTE = '52998224725'; // CPF sintético com dígitos verificadores válidos
const IN = { cessaoId: 'cessao_1', operador: 'admin-panel' };
const pessoa = (over: Record<string, unknown> = {}) => ({ cpfNormalizado: CPF_CEDENTE, isSyntheticCpf: false, kycAprovado: true, ...over });
const lead = (over: Record<string, unknown> = {}) => ({ cpf: CPF_CEDENTE, pessoa: pessoa(), ...over });

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
  m.lock.mockResolvedValue(0);
  m.transfUpdate.mockResolvedValue({});
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
    // sandbox (Asaas) = PIX_SANDBOX; nunca PIX_REAL (reservado ao PSP de produção, ainda inexistente)
    expect(m.pagamentoUpsert.mock.calls[0][0].create).toMatchObject({ metodo: 'PIX_SANDBOX', onChainTxHash: TX, status: 'EXECUTADO', comprovanteUrl: 'comprovantes-psp/cessao_1.json' });
    expect(m.leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead_1' }, data: { status: 'PIX_EXECUTADO' } });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PIX_SANDBOX_EXECUTADO', payloadHash: SHA, stellarTxHash: TX, cessaoId: 'cessao_1', operador: 'admin-panel' });
    expect(audit.payloadHash).toBe(audit.payloadJson.comprovanteSha256); // payloadHash = memo = SHA-256 do comprovante
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${CPF_CEDENTE}|chavePix`, 'i')); // sem CPF nem chave Pix
  });

  it('rótulos: ASAAS (sandbox) = PIX_SANDBOX / PIX_SANDBOX_EXECUTADO; SIMULADO = PIX_SIMULADO / PIX_SIMULADO_EXECUTADO; PIX_REAL nunca', async () => {
    await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect(m.pagamentoUpsert.mock.calls[0][0].create.metodo).toBe('PIX_SANDBOX');
    expect(m.auditCreate.mock.calls[0][0].data.acao).toBe('PIX_SANDBOX_EXECUTADO');
    m.pagamentoUpsert.mockClear(); m.auditCreate.mockClear();
    m.transf.mockResolvedValue(comprovada({ provedor: 'SIMULADO' }));
    await pagarCedenteDaCessao(IN, { provider: prov('SIMULADO') });
    expect(m.pagamentoUpsert.mock.calls[0][0].create.metodo).toBe('PIX_SIMULADO');
    expect(m.auditCreate.mock.calls[0][0].data.acao).toBe('PIX_SIMULADO_EXECUTADO');
  });

  it('F-FIA-1: em PUBLIC o Asaas (sandbox por código) também é recusado, sem PSP e sem gravar; fecharPagamento também recusa', async () => {
    m.rede.v = 'PUBLIC';
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'PROVEDOR_SEM_PAGAMENTO_REAL' });
    expect(m.pagar).not.toHaveBeenCalled();
    await expect(fecharPagamento('cessao_1')).rejects.toMatchObject({ code: 'PROVEDOR_SEM_PAGAMENTO_REAL' });
    expect(m.pagamentoUpsert).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
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

describe('P2 (Argus/Atlas): o destino é o CPF da PESSOA verificada por KYC ligada ao lead, nunca o do chamador', () => {
  const cessaoCom = (leadVendedor: { pessoa?: { cpfNormalizado?: string | null } | null } | null) => ({
    id: 'cessao_1', status: 'ASSINADA', ofertaId: 'of_1',
    oferta: { valorLiquidoVendedor: D('1234.50'), leadVendedorId: 'lead_1', leadVendedor }, pagamento: null,
  });
  it.each([
    ['sem pessoa ligada ao lead', lead({ pessoa: null })],
    ['pessoa sem CPF', lead({ pessoa: pessoa({ cpfNormalizado: null }) })],
    ['CPF da pessoa inválido (dígito verificador)', lead({ pessoa: pessoa({ cpfNormalizado: '52998224726' }) })],
    ['CPF de dígitos repetidos', lead({ pessoa: pessoa({ cpfNormalizado: '11111111111' }) })],
    ['sem lead', null],
  ])('%s → CEDENTE_SEM_DOCUMENTO, nada vai ao PSP', async (_n, l) => {
    m.cessao.mockResolvedValueOnce(cessaoCom(l));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('KYC não aprovado → KYC_NAO_APROVADO, sem PSP', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: pessoa({ kycAprovado: false }) })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'KYC_NAO_APROVADO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('CPF sintético (dummy do sandbox): recusado com Asaas/qualquer provedor que não seja o SIMULADO (CPF_SINTETICO), sem PSP', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: pessoa({ isSyntheticCpf: true }) })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CPF_SINTETICO' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('CPF sintético com o provedor SIMULADO passa (não move dinheiro) e o EventoAudit de execução MARCA cpfSintetico:true; CPF real marca false', async () => {
    m.transf.mockResolvedValue(comprovada({ provedor: 'SIMULADO' }));
    m.cessao.mockResolvedValue(cessaoCom(lead({ pessoa: pessoa({ isSyntheticCpf: true }) })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('SIMULADO') })).resolves.toMatchObject({ status: 'COMPROVADA' });
    expect(m.auditCreate.mock.calls[0][0].data.payloadJson.cpfSintetico).toBe(true);
    m.auditCreate.mockClear();
    m.cessao.mockResolvedValue(cessaoCom(lead()));
    await pagarCedenteDaCessao(IN, { provider: prov('SIMULADO') });
    expect(m.auditCreate.mock.calls[0][0].data.payloadJson.cpfSintetico).toBe(false);
  });
  it('a recusa do sintético vale também na reabertura (provedor não simulado)', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: pessoa({ isSyntheticCpf: true }) })));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CPF_SINTETICO' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
  });
  it('o CPF autodeclarado no lead pode faltar (o fluxo atual nem o passa) e vem com máscara; se existir e contradizer a conta verificada → TITULAR_DIVERGE', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: null })));
    await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect((m.pagar.mock.calls[0] as unknown as [Record<string, string>])[0]).toMatchObject({ chavePix: CPF_CEDENTE, tipoChave: 'CPF' });
    m.pagar.mockClear();
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '529.982.247-25' })));
    await pagarCedenteDaCessao(IN, { provider: prov('ASAAS') });
    expect(m.pagar).toHaveBeenCalledOnce();
    m.pagar.mockClear();
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ cpf: '111.444.777-35' })));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TITULAR_DIVERGE' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it.each([
    ['documento de 14 dígitos na conta (Pessoa)', lead({ cpf: null, pessoa: pessoa({ cpfNormalizado: '11222333000181' }) })],
    ['documento de 14 dígitos declarado no lead', lead({ cpf: '11.222.333/0001-81' })],
  ])('cedente PJ/CNPJ (%s) → TRATAMENTO_MANUAL até o D30, sem PSP e nunca chave CNPJ automática', async (_n, l) => {
    m.cessao.mockResolvedValueOnce(cessaoCom(l));
    await expect(pagarCedenteDaCessao(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TRATAMENTO_MANUAL' });
    expect(m.pagar).not.toHaveBeenCalled();
  });
  it('a reabertura usa a mesma fonte e as mesmas recusas (KYC, sem pessoa)', async () => {
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: pessoa({ kycAprovado: false }) })));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'KYC_NAO_APROVADO' });
    m.cessao.mockResolvedValueOnce(cessaoCom(lead({ pessoa: null })));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CEDENTE_SEM_DOCUMENTO' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
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
    // O reabrirTransferencia real chama o hook DENTRO da transação da reabertura; o mock o reproduz.
    m.reabrir.mockImplementation(async (_i: unknown, o: { aoReabrir?: (tx: unknown, t: unknown) => Promise<void> }) => {
      m.ordem.push('reabertura:inicio');
      await o.aoReabrir?.(
        { eventoAudit: { create: m.auditCreate }, transferenciaPix: { update: m.transfUpdate } },
        { provedor: 'ASAAS', tentativaAnterior: 1, tentativaNova: 2, idempotencyKeyAnterior: 'pix-cedente:cessao_1', motivoAnterior: 'PSP_RECUSOU', providerIdAnterior: null },
      );
      m.ordem.push('reabertura:fim');
      return { status: 'PROCESSANDO' };
    });
  });

  it('FALHOU confirmado: grava EventoAudit PIX_REAL_REABERTO DENTRO da transação da reabertura (F-REAB-1) e reabre com o MESMO destino (CPF da pessoa verificada) e o valor da oferta', async () => {
    const r = await reabrirPagamentoCedente({ ...IN, chavePix: 'outra@pessoa.com', valor: '1.00' } as never, { provider: prov('ASAAS') });
    expect(r.status).toBe('PROCESSANDO');
    // o evento nasce dentro da reabertura (hook), não antes dela: sem corrida nem leitura velha deixando evento órfão
    expect(m.ordem).toEqual(['reabertura:inicio', 'audit', 'reabertura:fim']);
    expect(typeof (m.reabrir.mock.calls[0][1] as { aoReabrir?: unknown }).aoReabrir).toBe('function');
    expect(m.transfUpdate).toHaveBeenCalledWith({ where: { cessaoId: 'cessao_1' }, data: { alertadoEm: null } }); // F-FIA-6
    expect(m.reabrir.mock.calls[0][0]).toEqual({ cessaoId: 'cessao_1', valor: '1234.50', chavePix: CPF_CEDENTE, tipoChave: 'CPF', operador: 'admin-panel' });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PIX_REAL_REABERTO', operador: 'admin-panel', cessaoId: 'cessao_1', leadVendedorId: 'lead_1' });
    expect(audit.payloadJson).toMatchObject({ tentativaAnterior: 1, tentativaNova: 2, motivoAnterior: 'PSP_RECUSOU', idempotencyKeyAnterior: 'pix-cedente:cessao_1' });
    expect(JSON.stringify(audit)).not.toContain(CPF_CEDENTE); // sem CPF na auditoria
  });

  it('se a reabertura já concluiu (COMPROVADA), fecha o pagamento (Pagamento/lead/EventoAudit de execução)', async () => {
    m.reabrir.mockResolvedValue({ status: 'COMPROVADA', sha256: SHA, txHash: TX });
    m.transf.mockReset().mockResolvedValueOnce(falhou()).mockResolvedValue(comprovada()); // 1ª leitura FALHOU; depois, COMPROVADA
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

  it('o destino do cadastro mudou desde a tentativa anterior: DESTINO_DIVERGE (destino diferente = pós-D30), sem auditoria nem envio', async () => {
    m.transf.mockResolvedValue(falhou({ destinoMascarado: 'CPF ***9999' }));
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'DESTINO_DIVERGE' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.reabrir).not.toHaveBeenCalled();
  });

  it('sem transferência registrada, cessão não assinada, já paga, acima do teto ou mainnet: recusa sem auditoria nem envio', async () => {
    m.transf.mockResolvedValueOnce(null);
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'TRANSFERENCIA_NAO_ENCONTRADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'PENDENTE', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: null });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    m.cessao.mockResolvedValueOnce({ id: 'cessao_1', status: 'ASSINADA', oferta: { valorLiquidoVendedor: D('1'), leadVendedor: lead() }, pagamento: { status: 'EXECUTADO' } });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'PAGAMENTO_JA_EXECUTADO' });
    process.env.PIX_MAX_BRL = '10';
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'ACIMA_DO_TETO' });
    process.env.PIX_MAX_BRL = '50000';
    m.rede.v = 'PUBLIC';
    await expect(reabrirPagamentoCedente(IN, { provider: prov('SIMULADO') })).rejects.toMatchObject({ code: 'SIMULADO_EM_MAINNET' });
    await expect(reabrirPagamentoCedente(IN, { provider: prov('ASAAS') })).rejects.toMatchObject({ code: 'PROVEDOR_SEM_PAGAMENTO_REAL' });
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
  it('F-FIA-2: serializa por cessão (advisory lock na transação ANTES de ler o Pagamento) e o 2º fechamento não duplica', async () => {
    m.ordem.length = 0;
    m.lock.mockImplementation(async () => { m.ordem.push('lock'); return 0; });
    m.pagamentoFind.mockImplementation(async () => { m.ordem.push('find'); return null; });
    await fecharPagamento('cessao_1');
    expect(m.ordem.slice(0, 2)).toEqual(['lock', 'find']);
    expect(m.lock).toHaveBeenCalledOnce();
    m.pagamentoFind.mockResolvedValue({ id: 'pag_1', status: 'EXECUTADO' }); // depois do lock, vê o do outro
    m.auditCreate.mockClear();
    expect((await fecharPagamento('cessao_1')).criado).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('o operador do varredor é identificado no EventoAudit', async () => {
    await fecharPagamento('cessao_1');
    expect(m.auditCreate.mock.calls[0][0].data.operador).toBe('varredor-pix');
  });
});

describe('situacaoPagamentoDoCedente — campo do acompanhamento', () => {
  const executado = (over: Record<string, unknown> = {}) => ({ status: 'EXECUTADO', metodo: 'PIX_REAL', valor: D('1234.50'), executadoEm: new Date('2026-11-13T12:00:00.000Z'), ...over });
  beforeEach(() => {
    m.pagFind.mockResolvedValue(null);
    m.transf.mockResolvedValue(null);
    m.cessao.mockResolvedValue({ oferta: { valorLiquidoVendedor: D('1234.50') } });
  });

  it('sem transferência: NAO_INICIADO, não confirmado, sem data', async () => {
    expect(await situacaoPagamentoDoCedente('cessao_1')).toEqual({ situacaoPagamento: 'NAO_INICIADO', dataPagamento: null, confirmado: false, ambiente: null });
  });
  it.each(['ENVIANDO', 'PROCESSANDO'])('%s → EM_PROCESSAMENTO', async (status) => {
    m.transf.mockResolvedValue(comprovada({ status }));
    expect((await situacaoPagamentoDoCedente('cessao_1')).situacaoPagamento).toBe('EM_PROCESSAMENTO');
  });
  it.each(['INCERTO', 'FALHOU', 'COMPROVADA'])('%s sem Pagamento fechado → EM_CONFERENCIA (a equipe está tratando; o motivo não vai ao cedente)', async (status) => {
    m.transf.mockResolvedValue(comprovada({ status }));
    const r = await situacaoPagamentoDoCedente('cessao_1');
    expect(r).toEqual({ situacaoPagamento: 'EM_CONFERENCIA', dataPagamento: null, confirmado: false, ambiente: null });
  });
  it('REAL com DONE + e2eId + valor igual ao líquido da oferta → confirmado:true (checado no servidor)', async () => {
    m.pagFind.mockResolvedValue(executado());
    m.transf.mockResolvedValue(comprovada({ e2eId: 'E2E1' }));
    expect(await situacaoPagamentoDoCedente('cessao_1')).toEqual({ situacaoPagamento: 'PAGO', dataPagamento: '2026-11-13T12:00:00.000Z', confirmado: true, ambiente: 'REAL' });
  });
  it.each([
    ['sem e2eId', { e2eId: null }, {}],
    ['transferência de valor diferente do líquido', { e2eId: 'E' , valor: D('1.00') }, {}],
    ['Pagamento de valor diferente do líquido', { e2eId: 'E' }, { valor: D('999.00') }],
    ['transferência ainda não COMPROVADA', { e2eId: 'E', status: 'PROCESSANDO' }, {}],
    ['sem âncora', { e2eId: 'E', ancoraTxHash: null }, {}],
  ])('REAL, mas %s → PAGO porém confirmado:false', async (_n, tr, pg) => {
    m.pagFind.mockResolvedValue(executado(pg));
    m.transf.mockResolvedValue(comprovada(tr));
    const r = await situacaoPagamentoDoCedente('cessao_1');
    expect(r).toMatchObject({ situacaoPagamento: 'PAGO', confirmado: false, ambiente: 'REAL' });
  });
  it.each([['PIX_SANDBOX', 'SANDBOX'], ['PIX_SIMULADO', 'SIMULADO']] as const)('%s nunca é confirmado, mesmo com e2eId e valor certos; a tela rotula como teste (%s)', async (metodo, ambiente) => {
    m.pagFind.mockResolvedValue(executado({ metodo }));
    m.transf.mockResolvedValue(comprovada({ e2eId: 'E2E1' }));
    expect(await situacaoPagamentoDoCedente('cessao_1')).toMatchObject({ situacaoPagamento: 'PAGO', confirmado: false, ambiente });
  });
  it('Pagamento antigo sem TransferenciaPix (fluxo simulado legado) → PAGO, simulado, não confirmado', async () => {
    m.pagFind.mockResolvedValue(executado({ metodo: 'PIX_SIMULADO' }));
    m.transf.mockResolvedValue(null);
    expect(await situacaoPagamentoDoCedente('cessao_1')).toMatchObject({ situacaoPagamento: 'PAGO', confirmado: false, ambiente: 'SIMULADO' });
  });
  it('o retorno só tem os 4 campos (nada de valor, chave, CPF, ids do PSP nem hashes)', async () => {
    m.pagFind.mockResolvedValue(executado());
    m.transf.mockResolvedValue(comprovada({ e2eId: 'E2E1' }));
    expect(Object.keys(await situacaoPagamentoDoCedente('cessao_1')).sort()).toEqual(['ambiente', 'confirmado', 'dataPagamento', 'situacaoPagamento']);
  });
});
