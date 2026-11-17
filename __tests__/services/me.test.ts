import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  investidorFind: vi.fn(), leadFindMany: vi.fn(), holdingFind: vi.fn(), snapFind: vi.fn(), cotaFindMany: vi.fn(),
  quoteFindMany: vi.fn(), onrampFirst: vi.fn(), resgateFindMany: vi.fn(), eventoFindMany: vi.fn(), ofertaFindMany: vi.fn(),
  supply: vi.fn(), caixa: vi.fn(), soroban: vi.fn(), nav: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    investidor: { findUnique: m.investidorFind },
    leadVendedor: { findMany: m.leadFindMany },
    holdingPLINARF: { findUnique: m.holdingFind },
    snapshotNav: { findFirst: m.snapFind },
    cota: { findMany: m.cotaFindMany },
    quote: { findMany: m.quoteFindMany },
    onRampOrder: { findFirst: m.onrampFirst },
    resgateCotacao: { findMany: m.resgateFindMany },
    eventoAudit: { findMany: m.eventoFindMany },
    oferta: { findMany: m.ofertaFindMany },
  },
}));
vi.mock('@/lib/services/nav-supply', async (orig) => ({ ...(await orig<typeof import('@/lib/services/nav-supply')>()), lerSupplyDoNav: m.supply }));
vi.mock('@/lib/services/razao-fundo', () => ({ caixaParaNav: m.caixa }));
vi.mock('@/lib/env/feature-gates', () => ({ isSorobanWaterfallEnabled: m.soroban }));
vi.mock('@/lib/services/pool', () => ({ navPorTokenAsDecimal: m.nav }));
vi.mock('@/lib/stellar/config', async (orig) => {
  const mod = { ...(await orig<typeof import('@/lib/stellar/config')>()) } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => 'TESTNET', enumerable: true });
  return mod;
});

import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { CursorInvalidoError, codificarCursor, decodificarCursor, montarHistorico, montarResumo } from '@/lib/services/me';

const D = (v: string) => new Prisma.Decimal(v);
const user = (over: Record<string, unknown> = {}) =>
  ({ privyId: 'did:privy:1', email: 'ana@exemplo.test', pessoaId: 'p_1', nome: 'Ana Souza', publicKey: null, papeis: ['INVESTIDOR', 'CEDENTE'], kycAprovado: true, kycStatus: 'APROVADO', etherfuseCustomerId: null, ...over }) as never;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const f of Object.values(m)) f.mockReset();
  m.investidorFind.mockResolvedValue({ id: 'inv_1', status: 'AUTORIZADO' });
  m.leadFindMany.mockResolvedValue([]);
  m.holdingFind.mockResolvedValue({ saldo: D('10.5') });
  m.snapFind.mockResolvedValue({ publicadoEm: new Date('2026-11-15T09:00:00Z'), txHash: 'h'.repeat(64) });
  m.cotaFindMany.mockResolvedValue([]);
  m.quoteFindMany.mockResolvedValue([]);
  m.onrampFirst.mockResolvedValue(null);
  m.resgateFindMany.mockResolvedValue([]);
  m.eventoFindMany.mockResolvedValue([]);
  m.ofertaFindMany.mockResolvedValue([]);
  m.supply.mockResolvedValue({ senior: { circulante: D('1') } });
  m.caixa.mockResolvedValue([]);
  m.soroban.mockResolvedValue(false);
  m.nav.mockReturnValue(D('1.2345'));
});

describe('montarResumo', () => {
  it('pré-KYC (sem Pessoa): listas vazias, posicao null, bloqueio kyc_pendente, nada consultado', async () => {
    const r = await montarResumo(user({ pessoaId: null, nome: null, papeis: [] }));
    expect(r).toEqual({ nome: null, papeis: [], posicao: null, solicitacoes: [], operacoesPendentes: [], bloqueio: { motivo: 'kyc_pendente' } });
    expect(m.investidorFind).not.toHaveBeenCalled();
  });

  it('nome: e-mail ou vazio vira null (nunca o e-mail como nome)', async () => {
    expect((await montarResumo(user({ nome: 'ana@exemplo.test' }))).nome).toBeNull();
    expect((await montarResumo(user({ nome: 'Ana Souza' }))).nome).toBe('Ana Souza');
  });

  it('posição: tokens (7 casas), NAV (8), valor pelo NAV (2), fonte e snapshot; só consulta a SUA pessoaId/investidorId', async () => {
    const { posicao } = await montarResumo(user());
    expect(posicao).toEqual({
      tokens: '10.5000000', navPorToken: '1.23450000', valorPeloNav: '12.96', navFonte: 'ledger',
      snapshotEm: '2026-11-15T09:00:00.000Z', snapshotTxHash: 'h'.repeat(64),
    });
    expect(m.investidorFind.mock.calls[0][0].where).toEqual({ pessoaId: 'p_1' });
    expect(m.holdingFind.mock.calls[0][0].where).toEqual({ investidorId_classe: { investidorId: 'inv_1', classe: 'SENIOR' } });
    expect(m.snapFind.mock.calls[0][0].where).toEqual({ status: 'PUBLICADO' });
  });

  it('soroban ligado → navFonte soroban', async () => {
    m.soroban.mockResolvedValue(true);
    expect((await montarResumo(user())).posicao?.navFonte).toBe('soroban');
  });

  it('NAV indisponível (gate/ledger): navIndisponivel true, NAV e valor null — NUNCA 1 nem 0 —, tokens e snapshot seguem', async () => {
    m.supply.mockRejectedValue(new NavIndisponivelError('SWAP_EM_VOO'));
    const { posicao } = await montarResumo(user());
    expect(posicao).toMatchObject({ navIndisponivel: true, navPorToken: null, valorPeloNav: null, navFonte: null, tokens: '10.5000000' });
    expect(JSON.stringify(posicao)).not.toMatch(/"navPorToken":"?[01](\.0+)?"?[,}]/);
    expect(m.nav).not.toHaveBeenCalled();
  });

  it('não é investidor: posicao null e sem pendências', async () => {
    m.investidorFind.mockResolvedValue(null);
    const r = await montarResumo(user({ papeis: ['CEDENTE'] }));
    expect(r.posicao).toBeNull();
    expect(r.operacoesPendentes).toEqual([]);
    expect(m.holdingFind).not.toHaveBeenCalled();
  });

  it('solicitações abertas: filtra PERDIDO/COTA_INCORPORADA, só da pessoa, até 20, com cessaoStatus e valores em string', async () => {
    m.leadFindMany.mockResolvedValue([
      { id: 'lead_1', status: 'OFERTA_ACEITA', ofertas: [{ tipoBem: 'VEICULO', valorCarta: D('40000'), valorLiquidoVendedor: D('31200'), validade: new Date('2026-11-16T10:00:00Z'), cessao: { status: 'ENVIADA_DOCUSIGN' } }] },
      { id: 'lead_2', status: 'NOVO', ofertas: [] },
    ]);
    const { solicitacoes } = await montarResumo(user());
    const arg = m.leadFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ pessoaId: 'p_1', status: { notIn: ['PERDIDO', 'COTA_INCORPORADA'] } });
    expect(arg.take).toBe(20);
    expect(solicitacoes[0]).toEqual({ id: 'lead_1', status: 'OFERTA_ACEITA', etapa: expect.any(Number), tipoBem: 'VEICULO', valorCarta: '40000.00', valorLiquido: '31200.00', ofertaValidade: '2026-11-16T10:00:00.000Z', cessaoStatus: 'ENVIADA_DOCUSIGN' });
    expect(solicitacoes[1]).toMatchObject({ id: 'lead_2', tipoBem: null, valorCarta: null, valorLiquido: null, ofertaValidade: null, cessaoStatus: null });
  });

  const ordemDe = (o: { status?: string; cb?: string | null; claim?: string | null; submit?: string | null; valor?: string } = {}) => ({
    id: 'or_1',
    status: o.status ?? 'completed',
    stellarClaimableBalanceId: o.cb === undefined ? 'cb_1' : o.cb,
    claimTxHash: o.claim === undefined ? 'claim_tx' : o.claim,
    criadoEm: new Date('2026-11-16T10:00:00Z'),
    quote: { fromAmount: D(o.valor ?? '90.5'), submitXdrHash: o.submit ?? null, consumedAt: null },
  });

  it('operações pendentes: a compra não concluída vem da MESMA leitura da rota /investir (fase incluída); a saída segue pela cotação de resgate', async () => {
    m.onrampFirst.mockResolvedValue(ordemDe());
    m.resgateFindMany.mockResolvedValue([{ brlEquivalente: D('100'), submitXdrHash: null }]);
    const { operacoesPendentes } = await montarResumo(user());
    expect(operacoesPendentes).toEqual([
      { tipo: 'entrada', valor: '90.50', situacao: 'aguardando_assinatura', fase: 'concluir_swap', continuarEm: '/investir' },
      { tipo: 'saida', valor: '100.00', situacao: 'aguardando_assinatura', continuarEm: '/sacar' },
    ]);
    // a consulta é a do investidor, sem filtro de validade da cotação (a cotação dura ~2 min; o swap/build a renova)
    const where = m.onrampFirst.mock.calls[0][0].where;
    expect(where.investidorId).toBe('inv_1');
    expect(where.quote).toEqual({ consumedAt: null });
    expect(JSON.stringify(where)).not.toMatch(/expiresAt/);
    expect(m.resgateFindMany.mock.calls[0][0].where).toMatchObject({ investidorId: 'inv_1', consumedAt: null });
  });

  it('A-07: ordem liquidada com a COTAÇÃO JÁ EXPIRADA continua sendo pendência (era o buraco: sumia e o /inicio dizia "Nenhuma ação pendente")', async () => {
    // a consulta não filtra expiresAt; a ordem completed com claim feito é concluir_swap mesmo que a cotação tenha vencido há horas
    m.onrampFirst.mockResolvedValue(ordemDe({ valor: '300' }));
    const { operacoesPendentes } = await montarResumo(user());
    expect(operacoesPendentes).toEqual([{ tipo: 'entrada', valor: '300.00', situacao: 'aguardando_assinatura', fase: 'concluir_swap', continuarEm: '/investir' }]);
  });

  it.each([
    [{ status: 'pending', cb: null, claim: null }, 'aguardando_pagamento', 'aguardando_assinatura'],
    [{ status: 'processing', cb: null, claim: null }, 'liquidando', 'aguardando_assinatura'],
    [{ status: 'processing', cb: 'cb', claim: null }, 'resgatar_tesouro', 'aguardando_assinatura'],
    [{ status: 'completed', cb: 'cb', claim: 'c' }, 'concluir_swap', 'aguardando_assinatura'],
    [{ status: 'completed', cb: 'cb', claim: 'c', submit: 'x'.repeat(64) }, 'em_conferencia', 'em_conferencia'],
  ] as const)('fase da entrada %j → %s (situacao %s)', async (o, fase, situacao) => {
    m.onrampFirst.mockResolvedValue(ordemDe(o));
    const [op] = (await montarResumo(user())).operacoesPendentes;
    expect(op).toMatchObject({ tipo: 'entrada', fase, situacao, continuarEm: '/investir' });
  });

  it('ordem morta ou sem fase retomável não vira pendência', async () => {
    m.onrampFirst.mockResolvedValue(ordemDe({ status: 'status-novo' }));
    expect((await montarResumo(user())).operacoesPendentes).toEqual([]);
  });

  it('bloqueio: Investidor REVOGADO = conta_suspensa; sem KYC = kyc_pendente; KYC ok = null', async () => {
    m.investidorFind.mockResolvedValue({ id: 'inv_1', status: 'REVOGADO' });
    expect((await montarResumo(user())).bloqueio).toEqual({ motivo: 'conta_suspensa' });
    m.investidorFind.mockResolvedValue({ id: 'inv_1', status: 'AUTORIZADO' });
    expect((await montarResumo(user({ kycAprovado: false }))).bloqueio).toEqual({ motivo: 'kyc_pendente' });
    expect((await montarResumo(user())).bloqueio).toBeNull();
  });

  it('sem PII: nada de e-mail, CPF ou chave na resposta', async () => {
    const r = JSON.stringify(await montarResumo(user()));
    expect(r).not.toMatch(/ana@exemplo|cpf|pix|privy/i);
  });
});

describe('cursor', () => {
  it('ida e volta; lixo, vazio, JSON sem campos e data inválida → CursorInvalidoError', () => {
    const c = { em: new Date('2026-11-15T10:00:00.123Z'), id: 'ev_9' };
    expect(decodificarCursor(codificarCursor(c))).toEqual(c);
    for (const bad of ['', 'xxx', Buffer.from('{}').toString('base64url'), Buffer.from('{"t":"nada","i":"a"}').toString('base64url'), Buffer.from('{"t":"2026-11-15T10:00:00Z"}').toString('base64url')]) {
      expect(() => decodificarCursor(bad)).toThrow(CursorInvalidoError);
    }
  });
});

describe('montarHistorico', () => {
  const ev = (over: Record<string, unknown>) => ({ id: 'e1', acao: 'OFERTA_GERADA', criadoEm: new Date('2026-11-15T10:00:00Z'), stellarTxHash: null, leadVendedorId: 'lead_abcdef123456', cessaoId: null, payloadJson: { email: 'ana@exemplo.test', cpf: '123' }, ...over });

  beforeEach(() => {
    m.leadFindMany.mockResolvedValue([{ id: 'lead_abcdef123456' }]);
    m.ofertaFindMany.mockResolvedValue([{ leadVendedorId: 'lead_abcdef123456', valorLiquidoVendedor: D('31200') }]);
  });

  it('pessoa sem Pessoa, ou sem leads e sem investidor: vazio, sem consultar eventos', async () => {
    expect(await montarHistorico(user({ pessoaId: null }))).toEqual({ itens: [], proximoCursor: null });
    m.leadFindMany.mockResolvedValue([]);
    m.investidorFind.mockResolvedValue(null);
    expect(await montarHistorico(user())).toEqual({ itens: [], proximoCursor: null });
    expect(m.eventoFindMany).not.toHaveBeenCalled();
  });

  it('consulta só os eventos DA PESSOA (leads dela OU o investidor dela), só as ações mapeadas', async () => {
    await montarHistorico(user());
    const where = m.eventoFindMany.mock.calls[0][0].where.AND[0].OR;
    expect(where).toHaveLength(2);
    expect(where[0].leadVendedorId).toEqual({ in: ['lead_abcdef123456'] });
    expect(where[1].investidorId).toBe('inv_1');
    expect(where[0].acao.in).toContain('PIX_SIMULADO_EXECUTADO');
    expect(where[0].acao.in).not.toContain('SWAP_EXECUTADO');
    expect(where[1].acao.in).toEqual(['SWAP_EXECUTADO', 'PLINARF_LIQUIDADO']);
    expect(m.eventoFindMany.mock.calls[0][0].orderBy).toEqual([{ criadoEm: 'desc' }, { id: 'desc' }]);
  });

  it('vender: tipo, lado, valor líquido da oferta, referência (6 últimos, maiúsculas), link e SEM payload repassado', async () => {
    m.eventoFindMany.mockResolvedValue([ev({ id: 'a', acao: 'OFERTA_GERADA' }), ev({ id: 'b', acao: 'LEAD_VENDEDOR_CAPTURADO' })]);
    const { itens } = await montarHistorico(user());
    expect(itens[0]).toEqual({ id: 'a', tipo: 'proposta_recebida', em: '2026-11-15T10:00:00.000Z', lado: 'vender', valorBrl: '31200.00', tokens: null, situacao: 'concluido', txHash: null, referencia: '123456', link: '/vender/acompanhar/lead_abcdef123456', simulado: true });
    expect(itens[1]).toMatchObject({ tipo: 'solicitacao_enviada', valorBrl: null });
    expect(JSON.stringify(itens)).not.toMatch(/ana@exemplo|cpf|123"/);
  });

  it('pix_enviado: link do comprovante da cessão, txHash da âncora e simulado conforme a ação', async () => {
    m.eventoFindMany.mockResolvedValue([ev({ acao: 'PIX_SIMULADO_EXECUTADO', cessaoId: 'ces_1', stellarTxHash: 'tx1' })]);
    const [pix] = (await montarHistorico(user())).itens;
    expect(pix).toMatchObject({ tipo: 'pix_enviado', link: '/cessao/ces_1/comprovante', txHash: 'tx1', simulado: true, valorBrl: '31200.00' });
  });

  it('investir: entrada traz tokens do payload e o valor pago da cotação; saída traz tokens queimados e o valor pago; sem link', async () => {
    m.leadFindMany.mockResolvedValue([]);
    m.quoteFindMany.mockResolvedValue([{ id: 'q_1', fromAmount: D('150') }]);
    m.eventoFindMany.mockResolvedValue([
      ev({ id: 's', acao: 'SWAP_EXECUTADO', leadVendedorId: null, stellarTxHash: 'txs', payloadJson: { quoteId: 'q_1', amount: '99.5', mock: false } }),
      ev({ id: 'r', acao: 'PLINARF_LIQUIDADO', leadVendedorId: null, payloadJson: { amountPlinarf: '100', brlEquivalente: '120.5', queima: true } }),
    ]);
    const { itens } = await montarHistorico(user());
    expect(itens[0]).toMatchObject({ tipo: 'entrada_no_pool', lado: 'investir', tokens: '99.5000000', valorBrl: '150.00', txHash: 'txs', link: null, referencia: null });
    expect(itens[1]).toMatchObject({ tipo: 'saida_do_pool', tokens: '100.0000000', valorBrl: '120.50' });
    expect(m.quoteFindMany.mock.calls[0][0].where).toEqual({ id: { in: ['q_1'] }, investidorId: 'inv_1' }); // só cotação do próprio investidor
  });

  it('payload malformado não quebra: valores null', async () => {
    m.leadFindMany.mockResolvedValue([]);
    m.eventoFindMany.mockResolvedValue([ev({ acao: 'SWAP_EXECUTADO', leadVendedorId: null, payloadJson: { amount: 'abc', quoteId: 5 } }), ev({ id: 'z', acao: 'PLINARF_LIQUIDADO', leadVendedorId: null, payloadJson: null })]);
    const { itens } = await montarHistorico(user());
    expect(itens[0]).toMatchObject({ tokens: null, valorBrl: null });
    expect(itens[1]).toMatchObject({ tokens: null, valorBrl: null });
  });

  it('paginação: limit+1 detecta mais; proximoCursor = último item da página; cursor entra como chave (criadoEm, id)', async () => {
    const t = (min: number) => new Date(Date.UTC(2026, 10, 15, 10, min));
    m.eventoFindMany.mockResolvedValue([ev({ id: 'e3', criadoEm: t(3) }), ev({ id: 'e2', criadoEm: t(2) }), ev({ id: 'e1', criadoEm: t(1) })]);
    const p1 = await montarHistorico(user(), { limit: 2 });
    expect(m.eventoFindMany.mock.calls[0][0].take).toBe(3);
    expect(p1.itens.map((i) => i.id)).toEqual(['e3', 'e2']);
    expect(decodificarCursor(p1.proximoCursor!)).toEqual({ em: t(2), id: 'e2' });
    m.eventoFindMany.mockResolvedValue([ev({ id: 'e1', criadoEm: t(1) })]);
    const p2 = await montarHistorico(user(), { limit: 2, cursor: p1.proximoCursor! });
    expect(p2).toMatchObject({ itens: [{ id: 'e1' }], proximoCursor: null });
    expect(m.eventoFindMany.mock.calls[1][0].where.AND[1]).toEqual({ OR: [{ criadoEm: { lt: t(2) } }, { criadoEm: t(2), id: { lt: 'e2' } }] });
  });

  it('limit é limitado a 1..50 e o cursor inválido propaga CursorInvalidoError', async () => {
    await montarHistorico(user(), { limit: 999 });
    expect(m.eventoFindMany.mock.calls[0][0].take).toBe(51);
    await expect(montarHistorico(user(), { cursor: 'lixo' })).rejects.toBeInstanceOf(CursorInvalidoError);
  });
});
