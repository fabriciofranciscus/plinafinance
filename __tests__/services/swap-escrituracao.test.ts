import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  fetchTx: vi.fn(),
  situacao: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  incrementarHolding: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    quote: { updateMany: m.updateMany },
    investidor: { update: m.investidorUpdate },
    eventoAudit: { create: m.eventoCreate },
    movimentoFundo: { createMany: m.movimentoCreateMany },
  };
  return {
    db: {
      quote: { findMany: m.findMany, count: m.count, updateMany: m.updateMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/stellar/transactions', () => ({ fetchTransactionByHash: m.fetchTx }));
vi.mock('@/lib/stellar/orfa-swap', () => ({ situacaoEnvelopeSwap: m.situacao }));
vi.mock('@/lib/services/holdings', () => ({ incrementarHolding: m.incrementarHolding }));

import { VIGIA_LOTE, marcarConflitosAlertados, reconciliarSwapsOrfaos } from '@/lib/services/swap-escrituracao';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = Date.parse('2026-11-10T12:00:00Z');
const LIBERA = { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null, livreExpiradaVistaEm: null };

function orfa(over: Record<string, unknown> = {}) {
  return {
    id: 'q_1', investidorId: 'inv_1', fromAmount: D('150'), fee: '50', classe: 'SENIOR',
    plinarfAmount: D('99.5'), submitXdrHash: 'xh1', submitTxHash: 'th1', submitXdr: 'XDR1',
    submitMaxTime: new Date(AGORA + 60_000), onRampOrder: { id: 'ord_1' }, ...over,
  };
}
/** Chamadas de updateMany SEM o carimbo do rodízio da vigia (vigiaConsultadaEm). */
const semCarimbo = () => m.updateMany.mock.calls.filter((c) => !('vigiaConsultadaEm' in (c[0].data ?? {})));

/** 1ª consulta = órfãs; 2ª = vigia. */
const orfas = (lista: unknown[], vigia: unknown[] = []) =>
  m.findMany.mockResolvedValueOnce(lista).mockResolvedValueOnce(vigia);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.findMany.mockReset().mockResolvedValue([]);
  m.count.mockReset().mockResolvedValue(0);
  m.updateMany.mockReset().mockResolvedValue({ count: 1 });
  m.fetchTx.mockReset();
  m.situacao.mockReset();
  m.investidorUpdate.mockReset().mockResolvedValue({});
  m.eventoCreate.mockReset().mockResolvedValue({});
  m.movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  m.incrementarHolding.mockReset().mockResolvedValue(undefined);
});

describe('reconciliarSwapsOrfaos — prova pela conta do investidor (N1)', () => {
  it('ENTROU com sucesso: escritura sem o investidor (caixa líquido do fee, audit do reconciliador)', async () => {
    orfas([orfa()]);
    m.situacao.mockResolvedValue({ status: 'ENTROU', hash: 'th1', successful: true, ledger: 9 });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ escriturados: 1, liberados: 0, erros: 0 });
    expect(m.situacao).toHaveBeenCalledWith('XDR1');
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'q_1', consumedAt: null }, data: { consumedTxHash: 'th1' } });
    const mov = m.movimentoCreateMany.mock.calls[0][0].data[0];
    expect(new Prisma.Decimal(mov.valorBrl).toFixed(2)).toBe('100.00'); // 150 − 50
    expect(m.eventoCreate.mock.calls[0][0].data).toMatchObject({ acao: 'SWAP_EXECUTADO', operador: 'reconciliador-swap', privyId: null });
  });

  it('ENTROU mas FALHOU on-chain, ou S consumida por OUTRA tx do investidor: libera (sem vigia)', async () => {
    orfas([orfa(), orfa({ id: 'q_2', submitXdrHash: 'xh2' })]);
    m.situacao
      .mockResolvedValueOnce({ status: 'ENTROU', hash: 'th1', successful: false, ledger: 9 })
      .mockResolvedValueOnce({ status: 'OUTRA_TX', hash: 'outra' });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ liberados: 2, escriturados: 0 });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 'q_1', submitXdrHash: 'xh1', consumedAt: null }, data: LIBERA });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 'q_2', submitXdrHash: 'xh2', consumedAt: null }, data: LIBERA });
    expect(m.investidorUpdate).not.toHaveBeenCalled();
  });

  it('LIVRE_EXPIRADA na 1ª varredura: só MARCA (não libera); aguardando', async () => {
    orfas([orfa()]); // sem livreExpiradaVistaEm
    m.situacao.mockResolvedValue({ status: 'LIVRE_EXPIRADA', sequenceConta: '5', ledger: 9, fechadoEm: 'x' });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ aguardando: 1, liberados: 0 });
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'q_1', submitXdrHash: 'xh1', consumedAt: null },
      data: { livreExpiradaVistaEm: new Date(AGORA) },
    });
  });

  it('LIVRE_EXPIRADA na 2ª varredura (≥ 5 min depois da 1ª): libera POR TEMPO e põe o hash na vigia de 24 h', async () => {
    orfas([orfa({ livreExpiradaVistaEm: new Date(AGORA - 6 * 60_000) })]);
    m.situacao.mockResolvedValue({ status: 'LIVRE_EXPIRADA', sequenceConta: '5', ledger: 9, fechadoEm: 'x' });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ liberados: 1 });
    const data = m.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ ...LIBERA, liberadaTxHash: 'th1' });
    expect(data.liberadaPorTempoEm).toBeInstanceOf(Date);
  });

  it('2ª varredura cedo demais (< 5 min, disparo manual em sequência): NÃO libera, nem remarca', async () => {
    orfas([orfa({ livreExpiradaVistaEm: new Date(AGORA - 60_000) })]);
    m.situacao.mockResolvedValue({ status: 'LIVRE_EXPIRADA', sequenceConta: '5', ledger: 9, fechadoEm: 'x' });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ aguardando: 1, liberados: 0 });
    expect(semCarimbo()).toHaveLength(0);
  });

  it('a marca da 1ª varredura é apagada se o estado deixa de ser LIVRE_EXPIRADA (ex.: AGUARDANDO, INDETERMINADO)', async () => {
    orfas([orfa({ livreExpiradaVistaEm: new Date(AGORA - 6 * 60_000) })]);
    m.situacao.mockResolvedValue({ status: 'AGUARDANDO', liberaApos: 1 });
    await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'q_1', submitXdrHash: 'xh1', consumedAt: null },
      data: { livreExpiradaVistaEm: null },
    });
  });

  it('AGUARDANDO: nada muda; INDETERMINADO: fica órfã (operador), nunca libera', async () => {
    orfas([orfa(), orfa({ id: 'q_2', submitXdrHash: 'xh2' })]);
    m.situacao
      .mockResolvedValueOnce({ status: 'AGUARDANDO', liberaApos: 1 })
      .mockResolvedValueOnce({ status: 'INDETERMINADO', motivo: 'sem dado' });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ aguardando: 1, vencidasSemProva: 1, liberados: 0, escriturados: 0 });
    expect(semCarimbo()).toHaveLength(0);
  });

  it('erro do Horizon (sem decisão): mantém a reserva, conta o erro e segue as demais', async () => {
    orfas([orfa({ id: 'a' }), orfa({ id: 'b', submitXdrHash: 'xh2', submitXdr: 'XDR2' })]);
    m.situacao
      .mockRejectedValueOnce(new Error('horizon fora'))
      .mockResolvedValueOnce({ status: 'ENTROU', hash: 'th2', successful: true, ledger: 9 });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ erros: 1, escriturados: 1 });
  });

  it('commit que falha (quote consumido ao mesmo tempo) conta erro, sem derrubar o lote', async () => {
    orfas([orfa()]);
    m.situacao.mockResolvedValue({ status: 'ENTROU', hash: 'th1', successful: true, ledger: 9 });
    m.updateMany.mockResolvedValue({ count: 0 });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ erros: 1, escriturados: 0 });
  });

  it('sem ordem de onramp ou sem preço: não escritura às cegas (erro)', async () => {
    orfas([orfa({ onRampOrder: null }), orfa({ id: 'b', submitXdrHash: 'x2', plinarfAmount: null })]);
    m.situacao.mockResolvedValue({ status: 'ENTROU', hash: 'th', successful: true, ledger: 9 });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.erros).toBe(2);
    expect(m.investidorUpdate).not.toHaveBeenCalled();
  });

  it('reserva sem hash nem XDR (anterior às migrations): não toca, vai para o operador', async () => {
    orfas([orfa({ submitTxHash: null, submitXdr: null })]);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.semHash).toBe(1);
    expect(m.situacao).not.toHaveBeenCalled();
    expect(m.fetchTx).not.toHaveBeenCalled();
  });
});

describe('reconciliarSwapsOrfaos — reserva sem XDR guardado (só o hash)', () => {
  const semXdr = (over: Record<string, unknown> = {}) => orfa({ submitXdr: null, ...over });

  it('sucesso → escritura; falha → libera', async () => {
    orfas([semXdr(), semXdr({ id: 'b', submitXdrHash: 'xh2', submitTxHash: 'th2' })]);
    m.fetchTx.mockResolvedValueOnce({ hash: 'th1', successful: true }).mockResolvedValueOnce({ hash: 'th2', successful: false });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ escriturados: 1, liberados: 1 });
  });

  it('fora da chain: dentro do prazo aguarda; vencida NÃO libera por "não achei"', async () => {
    orfas([
      semXdr({ submitMaxTime: new Date(AGORA + 30_000) }),
      semXdr({ id: 'b', submitXdrHash: 'xh2', submitTxHash: 'th2', submitMaxTime: new Date(AGORA - 3_600_000) }),
    ]);
    m.fetchTx.mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ aguardando: 1, vencidasSemProva: 1, liberados: 0 });
    expect(semCarimbo()).toHaveLength(0);
  });
});

describe('reconciliarSwapsOrfaos — vigia de 24 h dos hashes liberados por tempo', () => {
  const vigiada = (over: Record<string, unknown> = {}) => ({
    id: 'q_v', investidorId: 'inv_1', fromAmount: D('150'), fee: '50', classe: 'SENIOR',
    plinarfAmount: D('99.5'), liberadaTxHash: 'th_lib', consumedAt: null, consumedTxHash: null, conflitoAlertadoEm: null,
    onRampOrder: { id: 'ord_1' }, ...over,
  });

  it('a consulta da vigia filtra a janela de 24 h', async () => {
    orfas([]);
    await reconciliarSwapsOrfaos({ agora: AGORA });
    const where = m.findMany.mock.calls[1][0].where;
    expect(where.liberadaTxHash).toEqual({ not: null });
    expect(where.liberadaPorTempoEm.gte).toEqual(new Date(AGORA - 24 * 3600_000));
  });

  it('tx liberada por tempo que ENTROU com sucesso: escritura + alerta', async () => {
    orfas([], [vigiada()]);
    m.fetchTx.mockResolvedValue({ hash: 'th_lib', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.vigiaEscrituradas).toBe(1);
    expect(m.updateMany.mock.calls[0][0].data.consumedTxHash).toBe('th_lib');
    expect(m.eventoCreate.mock.calls[0][0].data.operador).toBe('reconciliador-swap-vigia');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ALERTA vigia'), 'q_v');
  });

  it('ainda fora da chain ou falhou: nada a fazer', async () => {
    orfas([], [vigiada(), vigiada({ id: 'q_w', liberadaTxHash: 'th2' })]);
    m.fetchTx.mockResolvedValueOnce(null).mockResolvedValueOnce({ hash: 'th2', successful: false });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r).toMatchObject({ vigiaEscrituradas: 0, vigiaConflitos: 0, erros: 0 });
    expect(m.investidorUpdate).not.toHaveBeenCalled();
  });

  it('já escriturada com esse hash: ignora sem consultar a rede', async () => {
    orfas([], [vigiada({ consumedAt: new Date(), consumedTxHash: 'th_lib' })]);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(m.fetchTx).not.toHaveBeenCalled();
    expect(r.vigiaEscrituradas).toBe(0);
  });

  it('a liberada entrou MAS o quote já foi consumido por OUTRA tx: conflito em aberto (emissão dupla), NÃO escritura e NÃO grava a marca de alerta', async () => {
    orfas([], [vigiada({ consumedAt: new Date(), consumedTxHash: 'outra' })]);
    m.fetchTx.mockResolvedValue({ hash: 'th_lib', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.vigiaConflitos).toBe(1);
    expect(r.conflitoQuoteIds).toEqual(['q_v']);
    // a marca conflitoAlertadoEm só é gravada DEPOIS do e-mail entregue (marcarConflitosAlertados), nunca aqui
    expect(m.updateMany.mock.calls.some((c) => 'conflitoAlertadoEm' in (c[0].data ?? {}))).toBe(false);
    expect(m.investidorUpdate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ALERTA vigia'), 'q_v');
  });

  it('o conflito continua em aberto a cada varredura enquanto a marca não for gravada (alerta de novo)', async () => {
    m.fetchTx.mockResolvedValue({ hash: 'th_lib', successful: true });
    for (let i = 0; i < 2; i++) {
      orfas([], [vigiada({ consumedAt: new Date(), consumedTxHash: 'outra' })]);
      expect((await reconciliarSwapsOrfaos({ agora: AGORA })).conflitoQuoteIds).toEqual(['q_v']);
    }
  });

  it('conflito JÁ alertado: não conta de novo nem repete o alerta (dedupe, senão 1 e-mail por varredura por 24 h)', async () => {
    orfas([], [vigiada({ consumedAt: new Date(), consumedTxHash: 'outra', conflitoAlertadoEm: new Date() })]);
    m.fetchTx.mockResolvedValue({ hash: 'th_lib', successful: true });
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.vigiaConflitos).toBe(0);
    expect(r.conflitoQuoteIds).toEqual([]);
    expect(semCarimbo()).toHaveLength(0);
  });
});

describe('reconciliarSwapsOrfaos — vigia em lote com rodízio (Vera/Farol)', () => {
  const vig = (i: number) => ({
    id: `q_${i}`, investidorId: 'inv_1', fromAmount: D('150'), fee: '50', classe: 'SENIOR',
    plinarfAmount: D('99.5'), liberadaTxHash: `th_${i}`, consumedAt: null, consumedTxHash: null,
    conflitoAlertadoEm: null, onRampOrder: { id: 'ord_1' },
  });

  it('a consulta pede LOTE (50), rodízio (nunca consultadas primeiro, depois as mais antigas) e conta o total', async () => {
    orfas([]);
    await reconciliarSwapsOrfaos({ agora: AGORA });
    const arg = m.findMany.mock.calls[1][0];
    expect(VIGIA_LOTE).toBe(50);
    expect(arg.take).toBe(50);
    expect(arg.orderBy).toEqual([{ vigiaConsultadaEm: { sort: 'asc', nulls: 'first' } }, { liberadaPorTempoEm: 'asc' }]);
    expect(m.count).toHaveBeenCalledOnce();
    expect(m.count.mock.calls[0][0].where.liberadaPorTempoEm.gte).toEqual(new Date(AGORA - 24 * 3600_000));
  });

  it('mais hashes que o lote: consulta só o lote, devolve `restantes` (contagem) e carimba o lote para o rodízio avançar', async () => {
    m.count.mockResolvedValue(120);
    const lote = Array.from({ length: 50 }, (_, i) => vig(i));
    orfas([], lote);
    m.fetchTx.mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(m.fetchTx).toHaveBeenCalledTimes(50);
    expect(r.vigiaRestantes).toBe(70); // 120 − 50
    const carimbo = m.updateMany.mock.calls.find((c) => 'vigiaConsultadaEm' in c[0].data)!;
    expect(carimbo[0].where.id.in).toHaveLength(50);
    expect(carimbo[0].data.vigiaConsultadaEm).toEqual(new Date(AGORA));
  });

  it('cabe tudo no lote: restantes = 0; sem hashes na vigia: sem carimbo', async () => {
    m.count.mockResolvedValue(2);
    orfas([], [vig(1), vig(2)]);
    m.fetchTx.mockResolvedValue(null);
    expect((await reconciliarSwapsOrfaos({ agora: AGORA })).vigiaRestantes).toBe(0);
    m.updateMany.mockClear();
    orfas([], []);
    await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('o carimbo cobre também os já escriturados e os que deram erro (o rodízio não trava neles)', async () => {
    m.count.mockResolvedValue(3);
    orfas([], [vig(1), { ...vig(2), consumedAt: new Date(), consumedTxHash: 'th_2' }, vig(3)]);
    m.fetchTx.mockRejectedValueOnce(new Error('horizon fora')).mockResolvedValue(null);
    const r = await reconciliarSwapsOrfaos({ agora: AGORA });
    expect(r.erros).toBe(1);
    const carimbo = m.updateMany.mock.calls.find((c) => 'vigiaConsultadaEm' in c[0].data)!;
    expect(carimbo[0].where.id.in).toEqual(['q_1', 'q_2', 'q_3']);
  });
});

describe('marcarConflitosAlertados', () => {
  it('grava conflitoAlertadoEm só nos ainda sem marca', async () => {
    await marcarConflitosAlertados(['q_1', 'q_2'], AGORA);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q_1', 'q_2'] }, conflitoAlertadoEm: null },
      data: { conflitoAlertadoEm: new Date(AGORA) },
    });
  });

  it('lista vazia: não toca no banco', async () => {
    await marcarConflitosAlertados([]);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
