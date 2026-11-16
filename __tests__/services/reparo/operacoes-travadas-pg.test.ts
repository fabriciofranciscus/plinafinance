/**
 * `listarOperacoesTravadas` com Postgres REAL (T3, fatia 1; só leitura). Só roda com um Postgres descartável em TEST_PG_URL (localhost; migrations
 * aplicadas); sem a variável é pulado. Semeia uma operação PARADA de cada saga e uma que NÃO está parada, e confere tipo, estado, ações do
 * catálogo, idade, ausência de escrita e ausência de dado pessoal.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

import { db } from '@/lib/db';
import { listarOperacoesTravadas } from '@/lib/services/reparo/operacoes-travadas';

const AGORA = new Date();
const min = (n: number) => new Date(AGORA.getTime() - n * 60_000);
const futuro = (n: number) => new Date(AGORA.getTime() + n * 60_000);
const D = (v: string) => v;
const TABELAS = ['EventoAudit', 'TransferenciaPix', 'Pagamento', 'Cessao', 'Oferta', 'LeadVendedor', 'OffRampOrder', 'OnRampOrder', 'ResgateCotacao', 'Quote', 'TentativaEmissao', 'SnapshotNav', 'Investidor'];

async function quote(id: string, over: Record<string, unknown> = {}) {
  return db.quote.create({
    data: { id, investidorId: 'inv_r', fromCurrency: 'BRL', fromAmount: D('100'), toCurrency: 'TESOURO', toAmount: D('85.4'), exchangeRate: '1', fee: '0', expiresAt: futuro(5), ...over } as never,
  });
}
async function cessao(id: string, over: Record<string, unknown> = {}) {
  const lead = await db.leadVendedor.create({ data: { nome: 'Fulana Sigilo', email: `sigilo-${id}@exemplo.test` } as never });
  const of = await db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: D('40000'), administradora: 'Adm Sigilo', desagioAquisicao: D('0.2'), valorLiquidoVendedor: D('32000'), validade: futuro(60) } as never });
  return db.cessao.create({ data: { id, ofertaId: of.id, ...over } as never });
}
const tratado = (r: Awaited<ReturnType<typeof listarOperacoesTravadas>>, tipo: string, id: string) => r.itens.find((i) => i.tipo === tipo && i.alvoId === id);

describe.skipIf(!PG)('listarOperacoesTravadas — Postgres real, só leitura', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE ${TABELAS.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await db.investidor.create({ data: { id: 'inv_r', nome: 'Inv Sigilo', email: 'inv-sigilo@exemplo.test', publicKey: 'G' + 'B'.repeat(55), privyId: 'did:privy:r' } });
  });

  async function semear() {
    // swap e resgate: um parado (maxTime vencido há 30 min) e um ainda dentro do prazo
    await quote('q_orfa', { submitXdrHash: 'h1', submitTxHash: 't1', submitMaxTime: min(30) });
    await quote('q_voo', { submitXdrHash: 'h2', submitTxHash: 't2', submitMaxTime: futuro(2) });
    await quote('q_consumida', { submitXdrHash: 'h3', submitTxHash: 't3', submitMaxTime: min(60), consumedAt: min(50) });
    await db.resgateCotacao.create({ data: { id: 'rc_orfa', investidorId: 'inv_r', plinarfAmount: D('10'), brlEquivalente: D('10'), bridgeAmount: D('8'), taxaBridge: '1', bridgeCode: 'TESOURO', bridgeIssuer: 'GX', navPorTokenNaCotacao: D('1'), expiresAt: futuro(5), submitXdrHash: 'hr1', submitMaxTime: min(45) } as never });
    // saída em BRL: sem transação há 2 h; e uma com burn
    await quote('q_off1'); await quote('q_off2');
    await db.offRampOrder.create({ data: { id: 'off_sem', quoteId: 'q_off1', investidorId: 'inv_r', status: 'pending', criadoEm: min(120) } });
    await db.offRampOrder.create({ data: { id: 'off_ok', quoteId: 'q_off2', investidorId: 'inv_r', status: 'pending', burnStellarTxHash: 'burn', criadoEm: min(120) } });
    // cessões: assinatura pendente há 5 dias; envio preso; uma assinada
    await cessao('ces_aguarda', { status: 'ENVIADA_DOCUSIGN', docusignEnvelopeId: 'env1', criadaEm: min(5 * 24 * 60) });
    await cessao('ces_preso', { status: 'PENDENTE', docusignEnvioIniciadoEm: min(30) });
    await cessao('ces_ok', { status: 'ASSINADA', docusignEnvelopeId: 'env2' });
    // Pix: falhou, incerto, comprovada sem Pagamento (cessão inexistente), comprovada com Pagamento
    const base = { provedor: 'SIMULADO', valor: D('100.00'), destinoMascarado: 'CPF ***8901' };
    await db.transferenciaPix.create({ data: { cessaoId: 'pix_falhou', idempotencyKey: 'k1', status: 'FALHOU', criadoEm: min(60), ...base } as never });
    await db.transferenciaPix.create({ data: { cessaoId: 'pix_incerto', idempotencyKey: 'k2', status: 'INCERTO', criadoEm: min(60), ...base } as never });
    await db.transferenciaPix.create({ data: { cessaoId: 'pix_orfa', idempotencyKey: 'k3', status: 'COMPROVADA', criadoEm: min(60), ...base } as never });
    await db.transferenciaPix.create({ data: { cessaoId: 'ces_ok', idempotencyKey: 'k4', status: 'COMPROVADA', criadoEm: min(60), ...base } as never });
    await db.pagamento.create({ data: { cessaoId: 'ces_ok', metodo: 'PIX_SIMULADO', valor: D('100.00'), status: 'EXECUTADO' } as never });
    await db.transferenciaPix.create({ data: { cessaoId: 'pix_recente', idempotencyKey: 'k5', status: 'PROCESSANDO', criadoEm: min(5), ...base } as never });
    // emissão, snapshot, clawback
    const em = { txHash: 'x', envelopeXdr: 'AAAA', valorBrl: D('1'), quantidade: D('1'), navPorToken: D('1') };
    await db.tentativaEmissao.create({ data: { memoHash: 'memo_pend', maxTime: min(30), status: 'PENDENTE', ...em } as never });
    await db.tentativaEmissao.create({ data: { memoHash: 'memo_exp', maxTime: min(40), status: 'EXPIRADA', ...em } as never });
    await db.tentativaEmissao.create({ data: { memoHash: 'memo_fail', maxTime: min(35), status: 'FALHOU', ...em } as never });
    await db.tentativaEmissao.create({ data: { memoHash: 'memo_ok', maxTime: min(30), status: 'CONFIRMADA', ...em } as never });
    await db.snapshotNav.create({ data: { data: '2026-11-10', status: 'PUBLICANDO', conteudo: '{}', sha256: 'a'.repeat(64), navPorToken: D('1'), ledger: 1, travaAte: min(30), criadoEm: min(90) } as never });
    await db.snapshotNav.create({ data: { data: '2026-11-11', status: 'PUBLICADO', conteudo: '{}', sha256: 'b'.repeat(64), navPorToken: D('1'), ledger: 2 } as never });
    for (const [id, status] of [['cb_incerto', 'incerto'], ['cb_onchain', 'onchain'], ['cb_exec', 'executed'], ['cb_fail', 'failed']] as const) {
      await db.eventoAudit.create({ data: { id, acao: 'CLAWBACK_EXECUTADO', operador: 'admin:x', investidorId: 'inv_r', criadoEm: min(30), payloadJson: { pedidoId: id + '-0123456789abcdef', status } } as never });
    }
  }

  it('lista SÓ as paradas, com estado e ações do catálogo certos (e não lista as que andam)', async () => {
    await semear();
    const r = await listarOperacoesTravadas({ agora: AGORA });
    const esperado: Array<[string, string, string, string[]]> = [
      ['SWAP_ORFAO', 'q_orfa', 'RESERVA_ORFA', ['RECONCILIAR']],
      ['RESGATE_ORFAO', 'rc_orfa', 'RESERVA_ORFA', ['RECONCILIAR']],
      ['OFFRAMP', 'off_sem', 'ORDEM_SEM_TRANSACAO', ['CANCELAR_ORDEM']],
      ['CESSAO', 'ces_aguarda', 'AGUARDANDO_ASSINATURA', ['SINCRONIZAR']],
      ['CESSAO', 'ces_preso', 'ENVIO_PRESO', []],
      ['PIX_SAIDA', 'pix_falhou', 'FALHOU', ['REABRIR']],
      ['PIX_SAIDA', 'pix_incerto', 'INCERTO', ['RECONSULTAR']],
      ['PIX_SAIDA', 'pix_orfa', 'COMPROVADA_SEM_PAGAMENTO', []],
      ['INCORPORACAO', 'memo_pend', 'EMISSAO_PENDENTE', ['RETOMAR']],
      ['INCORPORACAO', 'memo_exp', 'EMISSAO_EXPIRADA', ['RETOMAR']],
      ['INCORPORACAO', 'memo_fail', 'EMISSAO_FALHOU', ['RETOMAR']],
      ['SNAPSHOT_NAV', '2026-11-10', 'PUBLICANDO_PRESO', ['RETOMAR']],
      ['CLAWBACK', 'cb_incerto', 'INCERTO', ['CONSULTAR_REDE']],
      ['CLAWBACK', 'cb_onchain', 'NA_REDE_SEM_REGISTRO', []],
    ];
    for (const [tipo, id, estado, acoes] of esperado) {
      const i = tratado(r, tipo, id);
      expect(i, `${tipo}/${id}`).toBeDefined();
      expect(i!.estado).toBe(estado);
      expect(i!.acoesPermitidas).toEqual(acoes);
      expect(i!.idadeMs).toBeGreaterThan(0);
      expect(i!.alvoCurto).toBe(id.slice(-6).toUpperCase());
    }
    expect(r.itens).toHaveLength(esperado.length); // nenhuma das que andam entrou
    for (const [tipo, id] of [['SWAP_ORFAO', 'q_voo'], ['SWAP_ORFAO', 'q_consumida'], ['OFFRAMP', 'off_ok'], ['CESSAO', 'ces_ok'], ['PIX_SAIDA', 'ces_ok'], ['PIX_SAIDA', 'pix_recente'], ['INCORPORACAO', 'memo_ok'], ['SNAPSHOT_NAV', '2026-11-11'], ['CLAWBACK', 'cb_exec'], ['CLAWBACK', 'cb_fail']]) {
      expect(tratado(r, tipo, id), `${tipo}/${id} não deveria estar parada`).toBeUndefined();
    }
    expect(r.porTipo.PIX_SAIDA).toBe(3);
    expect(r.truncado).toBe(false);
  });

  it('ordena por severidade (ALTA primeiro) e depois pela mais antiga', async () => {
    await semear();
    const r = await listarOperacoesTravadas({ agora: AGORA });
    const ordem = { ALTA: 0, MEDIA: 1, BAIXA: 2 } as const;
    for (let i = 1; i < r.itens.length; i++) {
      const a = r.itens[i - 1]!; const b = r.itens[i]!;
      expect(ordem[a.severidade]).toBeLessThanOrEqual(ordem[b.severidade]);
      if (a.severidade === b.severidade) expect(a.desde.getTime()).toBeLessThanOrEqual(b.desde.getTime());
    }
  });

  it('SÓ LEITURA: nenhuma tabela muda (contagens e carimbos de atualização iguais depois da listagem)', async () => {
    await semear();
    const foto = async () => JSON.stringify(await Promise.all([
      db.eventoAudit.count(), db.transferenciaPix.findMany({ select: { cessaoId: true, status: true, atualizadoEm: true } }),
      db.quote.findMany({ select: { id: true, submitXdrHash: true, consumedAt: true } }), db.snapshotNav.findMany({ select: { data: true, status: true, travaAte: true } }),
      db.cessao.findMany({ select: { id: true, status: true, atualizadaEm: true } }),
    ]));
    const antes = await foto();
    await listarOperacoesTravadas({ agora: AGORA });
    await listarOperacoesTravadas({ agora: AGORA });
    expect(await foto()).toBe(antes);
  });

  it('sem PII: a resposta não leva nome, e-mail, destino do Pix nem administradora', async () => {
    await semear();
    const texto = JSON.stringify(await listarOperacoesTravadas({ agora: AGORA }));
    expect(texto).not.toMatch(/Sigilo|exemplo\.test|CPF \*\*\*|Adm Sigilo|inv-sigilo/);
  });

  it('limitePorTipo: com mais itens que o limite, lista o limite e marca truncado', async () => {
    for (let i = 0; i < 4; i++) await quote(`q_o${i}`, { submitXdrHash: `hh${i}`, submitTxHash: `tt${i}`, submitMaxTime: min(30 + i) });
    const r = await listarOperacoesTravadas({ agora: AGORA, limitePorTipo: 3 });
    expect(r.porTipo.SWAP_ORFAO).toBe(3);
    expect(r.truncado).toBe(true);
  });

  it('banco vazio: lista vazia e contagens zero', async () => {
    const r = await listarOperacoesTravadas({ agora: AGORA });
    expect(r.itens).toEqual([]);
    expect(Object.values(r.porTipo).every((n) => n === 0)).toBe(true);
    expect(r.truncado).toBe(false);
  });
});
