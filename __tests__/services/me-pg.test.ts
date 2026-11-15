/**
 * "Minha conta" (item 12) contra o Postgres REAL: as consultas de lib/services/me.ts rodam de verdade (filtros, relação `is`,
 * cursor por chave (criadoEm, id)) e o isolamento entre pessoas é provado com DADOS de duas pessoas no mesmo banco.
 * Só roda com um Postgres descartável em TEST_PG_URL (localhost, migrations aplicadas). Recusa host que não seja local.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
      throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    }
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
vi.mock('@/lib/services/nav-supply', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/nav-supply')>()),
  lerSupplyDoNav: vi.fn(async () => ({ senior: { circulante: '1000', tesouraria: '0', totalEmitido: '1000', autorizado: '1000', naoAutorizado: '0', emTransito: '0', contas: 1, temSaldoCongelado: false, lidoEm: new Date() } })),
}));

import { db } from '@/lib/db';
import { montarHistorico, montarResumo } from '@/lib/services/me';

const user = (pessoaId: string) => ({ privyId: `did:${pessoaId}`, email: `${pessoaId}@exemplo.test`, pessoaId, nome: 'Fulano de Teste', publicKey: null, papeis: ['INVESTIDOR'], kycAprovado: true, kycStatus: 'APROVADO', etherfuseCustomerId: null }) as never;
const T = (min: number) => new Date(Date.UTC(2026, 10, 15, 10, min));

describe.skipIf(!PG)('me — consultas reais no Postgres', () => {
  beforeAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE "EventoAudit","Oferta","LeadVendedor","Quote","OnRampOrder","ResgateCotacao","HoldingPLINARF","SnapshotNav","Investidor","Pessoa" RESTART IDENTITY CASCADE');
    for (const [i, id] of ['pA', 'pB'].entries()) {
      await db.pessoa.create({ data: { id, privyId: `did:${id}`, email: `${id}@exemplo.test`, nome: id, publicKey: `G${id}`, kycAprovado: true } });
      await db.investidor.create({ data: { id: `inv${id}`, pessoaId: id, nome: id, email: `${id}@exemplo.test`, publicKey: `G${id}`, status: 'AUTORIZADO' } });
      await db.holdingPLINARF.create({ data: { investidorId: `inv${id}`, classe: 'SENIOR', saldo: i === 0 ? '10.5' : '999' } });
      await db.leadVendedor.create({ data: { id: `lead${id}abcdef`, nome: id, email: `lead-${id}@exemplo.test`, pessoaId: id, status: 'OFERTA_ENVIADA' } });
      await db.oferta.create({ data: { id: `of${id}`, leadVendedorId: `lead${id}abcdef`, tipoBem: 'VEICULO', valorCarta: '40000', administradora: 'Adm', desagioAquisicao: '0.2200', valorLiquidoVendedor: '31200', validade: new Date(Date.now() + 86_400_000), status: 'ENVIADA' } });
    }
    await db.leadVendedor.create({ data: { id: 'leadAperdido', nome: 'x', email: 'perdido@exemplo.test', pessoaId: 'pA', status: 'PERDIDO' } });
    await db.snapshotNav.create({ data: { data: '2026-11-15', status: 'PUBLICADO', conteudo: '{}', sha256: 'a'.repeat(64), navPorToken: '1', ledger: 1, txHash: 'snaptx', publicadoEm: T(0) } });
    // 5 eventos da pessoa A (3 de vender, 2 de investir) + 1 da B (não pode vazar) + 1 ação fora do mapa (não aparece)
    const ev = (id: string, acao: string, min: number, extra: Record<string, unknown>) => db.eventoAudit.create({ data: { id, acao: acao as never, criadoEm: T(min), ...extra } });
    await ev('e1', 'LEAD_VENDEDOR_CAPTURADO', 1, { leadVendedorId: 'leadpAabcdef', payloadJson: { email: 'pA@exemplo.test' } });
    await ev('e2', 'OFERTA_GERADA', 2, { leadVendedorId: 'leadpAabcdef' });
    await ev('e3', 'SWAP_EXECUTADO', 3, { investidorId: 'invpA', stellarTxHash: 'tx3', payloadJson: { quoteId: 'q1', amount: '5' } });
    await ev('e4', 'PLINARF_LIQUIDADO', 4, { investidorId: 'invpA', payloadJson: { amountPlinarf: '2', brlEquivalente: '2.4' } });
    await ev('e5', 'COTA_INCORPORADA', 5, { leadVendedorId: 'leadpAabcdef' });
    await ev('e6', 'OFERTA_GERADA', 6, { leadVendedorId: 'leadpBabcdef' });
    await ev('e7', 'TOKEN_EMITIDO', 7, { investidorId: 'invpA' });
    // dois eventos no MESMO instante: a chave (criadoEm, id) tem de desempatar sem perder nem repetir
    await ev('e8a', 'OFERTA_ACEITA', 8, { leadVendedorId: 'leadpAabcdef' });
    await ev('e8b', 'CESSAO_ASSINADA', 8, { leadVendedorId: 'leadpAabcdef' });
    await db.quote.create({ data: { id: 'q1', investidorId: 'invpA', fromCurrency: 'BRL', fromAmount: '150', toCurrency: 'TESOURO', toAmount: '128', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() } });
    await db.quote.create({ data: { id: 'q2', investidorId: 'invpA', fromCurrency: 'BRL', fromAmount: '90.5', toCurrency: 'TESOURO', toAmount: '77', exchangeRate: '1', fee: '0', expiresAt: new Date(Date.now() + 60_000), plinarfAmount: '70' } });
    await db.onRampOrder.create({ data: { id: 'or2', quoteId: 'q2', investidorId: 'invpA', status: 'completed' } as never });
    await db.resgateCotacao.create({ data: { id: 'r1', investidorId: 'invpA', plinarfAmount: '2', brlEquivalente: '100', bridgeAmount: '80', taxaBridge: '1.25', bridgeCode: 'TESOURO', bridgeIssuer: 'GX', navPorTokenNaCotacao: '1', expiresAt: new Date(Date.now() + 60_000) } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('resumo da pessoa A: só os dados dela (tokens, solicitação aberta sem a PERDIDO, snapshot, pendências)', async () => {
    const r = await montarResumo(user('pA'));
    expect(r.posicao).toMatchObject({ tokens: '10.5000000', snapshotTxHash: 'snaptx' });
    expect(r.solicitacoes.map((s) => s.id)).toEqual(['leadpAabcdef']);
    expect(r.solicitacoes[0]).toMatchObject({ valorLiquido: '31200.00', valorCarta: '40000.00', cessaoStatus: null });
    const pend = r.operacoesPendentes;
    expect(pend).toContainEqual({ tipo: 'saida', valor: '100.00', situacao: 'aguardando_assinatura', continuarEm: '/sacar' });
    // cotação q2: ordem de entrada concluída + vigente + não consumida; a q1 (consumida) NÃO é pendência
    expect(pend).toContainEqual({ tipo: 'entrada', valor: '90.50', situacao: 'aguardando_assinatura', continuarEm: '/investir' });
    expect(pend.filter((p) => p.tipo === 'entrada')).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/999|pB|leadpB/); // nada da pessoa B
  });

  it('resumo da pessoa B não vê nada da A', async () => {
    const r = await montarResumo(user('pB'));
    expect(r.posicao?.tokens).toBe('999.0000000');
    expect(r.solicitacoes.map((s) => s.id)).toEqual(['leadpBabcdef']);
    expect(r.operacoesPendentes).toEqual([]);
  });

  it('histórico da A: só eventos dela e só ações mapeadas, mais recente primeiro; o da B e o TOKEN_EMITIDO não aparecem', async () => {
    const { itens, proximoCursor } = await montarHistorico(user('pA'), { limit: 50 });
    expect(itens.map((i) => i.id)).toEqual(['e8b', 'e8a', 'e5', 'e4', 'e3', 'e2', 'e1']);
    expect(proximoCursor).toBeNull();
    expect(itens.find((i) => i.id === 'e3')).toMatchObject({ tipo: 'entrada_no_pool', tokens: '5.0000000', valorBrl: '150.00', txHash: 'tx3' });
    expect(itens.find((i) => i.id === 'e4')).toMatchObject({ tipo: 'saida_do_pool', tokens: '2.0000000', valorBrl: '2.40' });
    expect(itens.find((i) => i.id === 'e2')).toMatchObject({ valorBrl: '31200.00', referencia: 'ABCDEF' });
  });

  it('paginação por cursor com eventos no MESMO instante: páginas de 2 percorrem tudo, sem repetir nem perder', async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const p = await montarHistorico(user('pA'), { limit: 2, cursor });
      vistos.push(...p.itens.map((x) => x.id));
      if (!p.proximoCursor) break;
      cursor = p.proximoCursor;
    }
    expect(vistos).toEqual(['e8b', 'e8a', 'e5', 'e4', 'e3', 'e2', 'e1']);
  });

  it('histórico da B: só o dele', async () => {
    expect((await montarHistorico(user('pB'))).itens.map((i) => i.id)).toEqual(['e6']);
  });
});
