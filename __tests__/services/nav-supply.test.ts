import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { fetchSupplyDasClasses, tentativaFindFirst } = vi.hoisted(() => ({
  fetchSupplyDasClasses: vi.fn(),
  tentativaFindFirst: vi.fn(),
}));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses }));
vi.mock('@/lib/db', () => ({ db: { tentativaEmissao: { findFirst: tentativaFindFirst } } }));

import {
  NAV_INDISPONIVEL_MENSAGEM,
  NAV_SUPPLY_TTL_MS,
  NavIndisponivelError,
  lerSupplyDoNav,
  resetNavSupplyCache,
} from '@/lib/services/nav-supply';

const D = (v: string) => new Prisma.Decimal(v);
function supply(code: string, circulante: string) {
  return { code, circulante: D(circulante), tesouraria: D('0') } as never;
}
function ledger(seniorCirc = '1000', subCirc = '0') {
  return { senior: supply('PLINARF', seniorCirc), subordinada: supply('PLINARFB', subCirc) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetNavSupplyCache();
  fetchSupplyDasClasses.mockReset().mockResolvedValue(ledger());
  tentativaFindFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lerSupplyDoNav — fail-closed', () => {
  it('Horizon falha → NavIndisponivelError sem a mensagem original', async () => {
    fetchSupplyDasClasses.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.9:443 STELLAR_ISSUER_PUBLIC'));
    const err = await lerSupplyDoNav().catch((e) => e);
    expect(err).toBeInstanceOf(NavIndisponivelError);
    expect(err.motivo).toBe('LEDGER_LEITURA_FALHOU');
    expect(err.code).toBe('LEDGER_UNAVAILABLE');
    expect(err.message).toBe(NAV_INDISPONIVEL_MENSAGEM);
    expect(err.message).not.toMatch(/ECONNREFUSED|STELLAR_/);
  });

  it('falha não é cacheada: a chamada seguinte tenta de novo', async () => {
    fetchSupplyDasClasses.mockRejectedValueOnce(new Error('x'));
    await expect(lerSupplyDoNav()).rejects.toBeInstanceOf(NavIndisponivelError);
    await expect(lerSupplyDoNav()).resolves.toMatchObject({ senior: { code: 'PLINARF' } });
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(2);
  });
});

describe('lerSupplyDoNav — trava D3 (PLINARFB circulando)', () => {
  it('PLINARFB circulante > 0 → recusa', async () => {
    fetchSupplyDasClasses.mockResolvedValue(ledger('1000', '0.0000001'));
    const err = await lerSupplyDoNav().catch((e) => e);
    expect(err).toBeInstanceOf(NavIndisponivelError);
    expect(err.motivo).toBe('SUBORDINADA_CIRCULANDO');
  });

  it('a trava vale também para o valor em cache', async () => {
    await lerSupplyDoNav(); // cacheia leitura sem PLINARFB
    fetchSupplyDasClasses.mockResolvedValue(ledger('1000', '5'));
    await vi.advanceTimersByTimeAsync(NAV_SUPPLY_TTL_MS + 1);
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'SUBORDINADA_CIRCULANDO' });
    // dentro do TTL da leitura "suja", continua recusando sem ir ao ledger
    fetchSupplyDasClasses.mockClear();
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'SUBORDINADA_CIRCULANDO' });
    expect(fetchSupplyDasClasses).not.toHaveBeenCalled();
  });

  it('PLINARFB zerado → devolve o supply da Sênior', async () => {
    const r = await lerSupplyDoNav();
    expect(r.senior.circulante.toString()).toBe('1000');
  });
});

describe('lerSupplyDoNav — TTL e single-flight', () => {
  it('2ª chamada dentro do TTL não vai ao ledger', async () => {
    await lerSupplyDoNav();
    await vi.advanceTimersByTimeAsync(NAV_SUPPLY_TTL_MS - 1);
    await lerSupplyDoNav();
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(1);
  });

  it('depois do TTL lê de novo', async () => {
    await lerSupplyDoNav();
    await vi.advanceTimersByTimeAsync(NAV_SUPPLY_TTL_MS + 1);
    await lerSupplyDoNav();
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(2);
  });

  it('chamadas simultâneas compartilham uma única leitura', async () => {
    let resolve!: (v: unknown) => void;
    fetchSupplyDasClasses.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const calls = Promise.all(Array.from({ length: 25 }, () => lerSupplyDoNav()));
    resolve(ledger());
    const out = await calls;
    expect(out).toHaveLength(25);
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(1);
  });

  it('falha em voo derruba todas as simultâneas, uma leitura só', async () => {
    let reject!: (e: unknown) => void;
    fetchSupplyDasClasses.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const calls = Array.from({ length: 5 }, () => lerSupplyDoNav().catch((e) => e));
    reject(new Error('boom'));
    const out = await Promise.all(calls);
    expect(out.every((e) => e instanceof NavIndisponivelError)).toBe(true);
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(1);
  });

  it('fresh ignora o TTL e renova o cache', async () => {
    await lerSupplyDoNav();
    fetchSupplyDasClasses.mockResolvedValue(ledger('2000'));
    const fresco = await lerSupplyDoNav({ fresh: true });
    expect(fresco.senior.circulante.toString()).toBe('2000');
    expect(fetchSupplyDasClasses).toHaveBeenCalledTimes(2);
    fetchSupplyDasClasses.mockClear();
    expect((await lerSupplyDoNav()).senior.circulante.toString()).toBe('2000');
    expect(fetchSupplyDasClasses).not.toHaveBeenCalled();
  });
});

describe('lerSupplyDoNav — emissão em voo (TentativaEmissao PENDENTE/CONFIRMADA)', () => {
  it('tentativa PENDENTE + supply do ledger já com +q → NAV indisponível (nada de NAV caindo 23%)', async () => {
    // O ledger já tem o token emitido (+q), o domínio ainda não: ler o supply daria o NAV errado.
    fetchSupplyDasClasses.mockResolvedValue(ledger('1235714'));
    tentativaFindFirst.mockResolvedValue({ memoHash: 'abc' });
    const err = await lerSupplyDoNav().catch((e) => e);
    expect(err).toBeInstanceOf(NavIndisponivelError);
    expect(err.motivo).toBe('EMISSAO_PENDENTE');
    expect(err.message).toBe(NAV_INDISPONIVEL_MENSAGEM);
    expect(tentativaFindFirst).toHaveBeenCalledWith({
      where: { status: { in: ['PENDENTE', 'CONFIRMADA'] }, aplicadaEm: null },
      select: { memoHash: true },
    });
  });

  it('vale também com a leitura fresca (resgate/emissão) e com o supply em cache', async () => {
    await lerSupplyDoNav(); // cacheia
    tentativaFindFirst.mockResolvedValue({ memoHash: 'abc' });
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });
    await expect(lerSupplyDoNav({ fresh: true })).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });
  });

  it('resolvida a tentativa, o NAV volta na chamada seguinte', async () => {
    tentativaFindFirst.mockResolvedValueOnce({ memoHash: 'abc' });
    await expect(lerSupplyDoNav()).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });
    await expect(lerSupplyDoNav()).resolves.toMatchObject({ senior: { code: 'PLINARF' } });
  });

  it('falha ao ler as tentativas é fail-closed, sem vazar a causa', async () => {
    tentativaFindFirst.mockRejectedValue(new Error('connect ECONNREFUSED db.internal'));
    const err = await lerSupplyDoNav().catch((e) => e);
    expect(err).toBeInstanceOf(NavIndisponivelError);
    expect(err.motivo).toBe('LEDGER_LEITURA_FALHOU');
    expect(err.message).not.toMatch(/ECONNREFUSED|db\.internal/);
  });
});
