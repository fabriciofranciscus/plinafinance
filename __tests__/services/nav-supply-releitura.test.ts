/**
 * #156 — falso SUPPLY_SEM_LASTRO depois de um resgate. O supply do ledger fica em cache (15 s) e o razão é lido na hora: logo após a
 * queima, o cache (pré-queima) é maior que o razão. Antes de fechar por esse motivo sobre valor de CACHE ou de leitura em voo, o
 * ledger é relido UMA vez. Condições do Argus (e C1/C2 da Estela): (1) devolve o supply FRESCO, com a trava D3 e o razão relido
 * depois dele; (2) uma releitura só, e falha dela fecha com LEDGER_LEITURA_FALHOU, nunca volta ao cache; (3) single-flight, renova
 * o cache e não vira amplificador do Horizon; (4) descasamento real continua fechando com o mesmo código e o mesmo log (só
 * quantidades).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const st = vi.hoisted(() => ({ ledger: vi.fn(), razao: vi.fn() }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.ledger }));
vi.mock('@/lib/db', () => ({
  db: {
    tentativaEmissao: { findFirst: async () => null },
    quote: { findFirst: async () => null },
    resgateCotacao: { findFirst: async () => null },
    movimentoFundo: { aggregate: st.razao },
  },
}));

import { NAV_RELEITURA_IDADE_MIN_MS, NAV_SUPPLY_TTL_MS, NavIndisponivelError, lerSupplyDoNav, resetNavSupplyCache } from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (senior: string, subordinada = '0') => ({
  senior: { circulante: D(senior), tesouraria: D('0') },
  subordinada: { circulante: D(subordinada), tesouraria: D('0') },
}) as never;
const razao = (v: string) => ({ _sum: { deltaTokens: D(v) } });
const ledgerE = (s: string, sub = '0') => st.ledger.mockResolvedValue(supply(s, sub));
const razaoE = (v: string) => st.razao.mockResolvedValue(razao(v));
const ler = (o?: { fresh?: boolean }) => lerSupplyDoNav(o).then(
  (r) => ({ ok: r.senior.circulante.toString() }),
  (e) => (e instanceof NavIndisponivelError ? { motivo: e.motivo } : Promise.reject(e)),
);
const logsDeLastro = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes('supply sem lastro'));
const passaTtl = () => vi.setSystemTime(new Date(Date.now() + NAV_SUPPLY_TTL_MS + 1));

/** Estado inicial: ledger 1000 = razão 1000, cache cheio. */
async function comCacheCheio() {
  ledgerE('1000'); razaoE('1000');
  expect(await ler()).toEqual({ ok: '1000' });
  st.ledger.mockClear();
}
/** Um resgate de 100: ledger e razão baixam juntos; o cache ainda tem 1000. */
const resgate = () => { ledgerE('900'); razaoE('900'); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  resetNavSupplyCache();
  st.ledger.mockReset(); st.razao.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('releitura fresca antes de fechar por falta de lastro sobre valor de cache', () => {
  it('depois de um resgate: abre, devolve o supply FRESCO (não o do cache), uma releitura e nenhum log de "sem lastro"', async () => {
    await comCacheCheio();
    resgate();
    expect(await ler()).toEqual({ ok: '900' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
    expect(logsDeLastro()).toHaveLength(0);
  });

  it('a releitura renova o cache: as chamadas seguintes não vão mais ao ledger', async () => {
    await comCacheCheio();
    resgate();
    await ler();
    for (let i = 0; i < 5; i++) expect(await ler()).toEqual({ ok: '900' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });

  it('o razão é lido DE NOVO depois da leitura fresca do ledger', async () => {
    await comCacheCheio();
    const ordem: string[] = [];
    st.ledger.mockImplementation(async () => { ordem.push('ledger'); return supply('900'); });
    st.razao.mockImplementation(async () => { ordem.push('razao'); return razao('900'); });
    await ler();
    expect(ordem).toEqual(['razao', 'ledger', 'razao']);
  });

  it('10 chamadas ao mesmo tempo sobre o cache velho: UMA releitura, todas abrem com o supply fresco', async () => {
    await comCacheCheio();
    resgate();
    const rs = await Promise.all(Array.from({ length: 10 }, () => ler()));
    expect(rs).toEqual(Array(10).fill({ ok: '900' }));
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });

  it('valor vindo de leitura EM VOO que ficou velho: relê uma vez e abre', async () => {
    let soltar!: (v: never) => void;
    st.ledger.mockImplementationOnce(() => new Promise((r) => { soltar = r as never; }));
    st.ledger.mockResolvedValue(supply('900'));
    razaoE('900'); // o resgate escriturou enquanto a 1ª leitura (pré-queima) estava no ar
    const a = ler();
    const b = ler(); // pega carona na leitura em voo
    await vi.waitFor(() => expect(st.ledger).toHaveBeenCalledTimes(1));
    soltar(supply('1000'));
    expect(await b).toEqual({ ok: '900' });
    await a;
    expect(st.ledger.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('dois resgates na mesma janela (separados por mais que a idade mínima): uma releitura para cada um', async () => {
    await comCacheCheio();
    resgate(); await ler();
    vi.setSystemTime(new Date(Date.now() + NAV_RELEITURA_IDADE_MIN_MS + 1));
    ledgerE('800'); razaoE('800');
    expect(await ler()).toEqual({ ok: '800' });
    expect(st.ledger).toHaveBeenCalledTimes(2);
  });

  it('valor que acabou de vir de uma releitura NÃO é relido de novo antes da idade mínima (fecha); depois dela, relê e abre', async () => {
    await comCacheCheio();
    resgate(); await ler();
    ledgerE('800'); razaoE('800'); // 2º resgate colado na releitura
    expect(await ler()).toEqual({ motivo: 'SUPPLY_SEM_LASTRO' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + NAV_RELEITURA_IDADE_MIN_MS + 1));
    expect(await ler()).toEqual({ ok: '800' });
    expect(st.ledger).toHaveBeenCalledTimes(2);
  });

  it('leitura mais VELHA que termina depois não substitui a mais nova no cache', async () => {
    let soltarVelha!: (v: never) => void;
    st.ledger.mockImplementationOnce(() => new Promise((r) => { soltarVelha = r as never; }));
    razaoE('900');
    const velha = ler(); // começou antes do resgate
    await vi.waitFor(() => expect(st.ledger).toHaveBeenCalledTimes(1));
    ledgerE('900');
    expect(await ler({ fresh: true })).toEqual({ ok: '900' }); // começou depois e terminou antes
    soltarVelha(supply('1000'));
    await velha;
    st.ledger.mockClear();
    expect(await ler()).toEqual({ ok: '900' });
    expect(st.ledger).not.toHaveBeenCalled();
  });

  it('a trava D3 vale para o supply relido', async () => {
    await comCacheCheio();
    ledgerE('900', '1'); razaoE('900');
    expect(await ler()).toEqual({ motivo: 'SUBORDINADA_CIRCULANDO' });
  });

  it('leitura `fresh` no meio não é desfeita: o valor mais novo continua valendo', async () => {
    await comCacheCheio();
    resgate();
    expect(await ler({ fresh: true })).toEqual({ ok: '900' }); // renova o cache
    st.ledger.mockClear();
    expect(await ler()).toEqual({ ok: '900' });
    expect(st.ledger).not.toHaveBeenCalled();
  });
});

describe('descasamento REAL continua fechando, sem martelar o ledger', () => {
  it('desde o início: N chamadas com cache = 1 leitura do ledger no TTL; todas SUPPLY_SEM_LASTRO, log só com quantidades', async () => {
    ledgerE('1000'); razaoE('900');
    for (let i = 0; i < 10; i++) expect(await ler()).toEqual({ motivo: 'SUPPLY_SEM_LASTRO' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
    expect(logsDeLastro().length).toBeGreaterThan(0);
    expect(logsDeLastro()[0]![1]).toEqual({ emitidoNoLedger: '1000', noRazao: '900', excedente: '100' });
  });

  it('aparecendo no meio da janela: UMA releitura confirma e as seguintes não relêem', async () => {
    await comCacheCheio();
    ledgerE('1100'); razaoE('900'); // token a mais de verdade
    for (let i = 0; i < 10; i++) expect(await ler()).toEqual({ motivo: 'SUPPLY_SEM_LASTRO' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
    expect(logsDeLastro()[0]![1]).toEqual({ emitidoNoLedger: '1100', noRazao: '900', excedente: '200' }); // o relido, não o do cache
  });

  it('passada a idade mínima, ainda dentro do TTL: o descasamento já confirmado NÃO é relido de novo', async () => {
    await comCacheCheio();
    ledgerE('1100'); razaoE('900');
    await ler(); // a única releitura
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(Date.now() + NAV_RELEITURA_IDADE_MIN_MS + 1));
      expect(await ler()).toEqual({ motivo: 'SUPPLY_SEM_LASTRO' });
    }
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });

  it('chamadas simultâneas sobre um descasamento real: no máximo 1 releitura', async () => {
    await comCacheCheio();
    ledgerE('1100'); razaoE('950'); // o cache (1000) e o relido (1100) passam do razão
    const rs = await Promise.all(Array.from({ length: 10 }, () => ler()));
    expect(rs).toEqual(Array(10).fill({ motivo: 'SUPPLY_SEM_LASTRO' }));
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });

  it('a cada TTL vencido, uma leitura (não uma por chamada)', async () => {
    ledgerE('1000'); razaoE('900');
    for (let janela = 0; janela < 3; janela++) {
      for (let i = 0; i < 5; i++) await ler();
      passaTtl();
    }
    expect(st.ledger).toHaveBeenCalledTimes(3);
  });

  it('razão que continua caindo com o ledger parado: não relê a cada chamada', async () => {
    await comCacheCheio();
    razaoE('900'); // o razão baixou e o ledger NÃO: a releitura confirma o excesso
    for (let i = 0; i < 10; i++) await ler();
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });

  it('chamada `fresh` (compra, liquidação, snapshot) não relê: uma leitura e fecha', async () => {
    ledgerE('1000'); razaoE('900');
    expect(await ler({ fresh: true })).toEqual({ motivo: 'SUPPLY_SEM_LASTRO' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
  });
});

describe('falhas', () => {
  it('a releitura falha: LEDGER_LEITURA_FALHOU (nunca o valor do cache), sem novas leituras na janela e sem log de "sem lastro"', async () => {
    await comCacheCheio();
    razaoE('900');
    st.ledger.mockRejectedValue(new Error('horizon fora'));
    for (let i = 0; i < 5; i++) expect(await ler()).toEqual({ motivo: 'LEDGER_LEITURA_FALHOU' });
    expect(st.ledger).toHaveBeenCalledTimes(1);
    expect(logsDeLastro()).toHaveLength(0);
  });

  it('depois que a janela vence, volta a ler o ledger normalmente', async () => {
    await comCacheCheio();
    razaoE('900');
    st.ledger.mockRejectedValueOnce(new Error('horizon fora'));
    await ler();
    passaTtl();
    ledgerE('900');
    expect(await ler()).toEqual({ ok: '900' });
  });

  it('o razão não responde: LEDGER_LEITURA_FALHOU e nenhuma releitura', async () => {
    await comCacheCheio();
    st.razao.mockRejectedValue(new Error('banco fora'));
    expect(await ler()).toEqual({ motivo: 'LEDGER_LEITURA_FALHOU' });
    expect(st.ledger).not.toHaveBeenCalled();
  });
});
