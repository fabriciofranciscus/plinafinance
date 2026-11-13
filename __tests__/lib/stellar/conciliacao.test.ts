import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { Prisma } from '@prisma/client';

const { fetchSupplyOnChain, accountsCall } = vi.hoisted(() => ({
  fetchSupplyOnChain: vi.fn(),
  accountsCall: vi.fn(),
}));

vi.mock('@/lib/stellar/supply', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/supply')>()),
  fetchSupplyOnChain,
}));
vi.mock('@/lib/stellar/account', () => ({
  horizon: {
    accounts: () => {
      const b = { forAsset: () => b, limit: () => b, call: accountsCall };
      return b;
    },
  },
}));

import {
  ConciliacaoError,
  conciliarAsset,
  exigirConciliacao,
} from '@/lib/stellar/conciliacao';
import { SupplyConfigError } from '@/lib/stellar/supply';

/** E3-4b — contrato: contratos/2026-11-11-e3-4b-conciliacao.md. */
const ISSUER = Keypair.random().publicKey();
const DISTRIBUTOR = Keypair.random().publicKey();
const D = (v: string) => new Prisma.Decimal(v);

function supply(code: string, over: Partial<Record<string, string>> = {}) {
  return {
    code,
    issuer: ISSUER,
    circulante: D(over.circulante ?? '600'),
    naoAutorizado: D(over.naoAutorizado ?? '0'),
    autorizadoParaObrigacoes: D(over.autorizadoParaObrigacoes ?? '0'),
    emTransito: D(over.emTransito ?? '0'),
  };
}

function conta(id: string, code: string, balance: string, autorizada = true) {
  return { account_id: id, balances: [{ asset_code: code, asset_issuer: ISSUER, balance, is_authorized: autorizada }] };
}

/** Páginas de /accounts por code. */
function paginas(porCode: Record<string, unknown[][]>) {
  accountsCall.mockImplementation(async () => {
    // O builder não expõe o code no mock; usa a ordem de chamada por code.
    const code = codesPedidos.shift() ?? 'PLINARF';
    const ps = porCode[code] ?? [[]];
    const pagina = (i: number): unknown => ({ records: ps[i] ?? [], next: async () => pagina(i + 1) });
    return pagina(0);
  });
}
let codesPedidos: string[] = [];

beforeEach(() => {
  vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
  vi.stubEnv('STELLAR_DISTRIBUTOR_PUBLIC', DISTRIBUTOR);
  fetchSupplyOnChain.mockReset().mockImplementation(async ({ code }: { code: string }) => {
    codesPedidos.push(code);
    return supply(code, code === 'PLINARFB' ? { circulante: '0' } : {});
  });
  accountsCall.mockReset();
  codesPedidos = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('conciliarAsset', () => {
  it('confere quando a soma das trustlines autorizadas = circulante (em 2 páginas, sem o distributor)', async () => {
    paginas({
      PLINARF: [
        [conta('GA', 'PLINARF', '400'), conta(DISTRIBUTOR, 'PLINARF', '9999')],
        [conta('GB', 'PLINARF', '200')],
      ],
    });
    const r = await conciliarAsset('PLINARF');
    expect(r.confere).toBe(true);
    expect(r.somaTrustlinesAutorizadas.toFixed(7)).toBe('600.0000000');
    expect(r.contasAutorizadas).toBe(2);
    expect(r.motivos).toEqual([]);
  });

  it('diverge quando a soma não bate', async () => {
    paginas({ PLINARF: [[conta('GA', 'PLINARF', '599.9999999')]] });
    const r = await conciliarAsset('PLINARF');
    expect(r.confere).toBe(false);
    expect(r.diferenca.toFixed(7)).toBe('-0.0000001');
    expect(r.motivos).toEqual(['soma_diverge']);
  });

  it('trustline desautorizada não entra na soma; motivo aparece', async () => {
    fetchSupplyOnChain.mockImplementationOnce(async ({ code }: { code: string }) => {
      codesPedidos.push(code);
      return supply(code, { circulante: '600', naoAutorizado: '100' });
    });
    paginas({ PLINARF: [[conta('GA', 'PLINARF', '500'), conta('GB', 'PLINARF', '100', false)]] });
    const r = await conciliarAsset('PLINARF');
    expect(r.confere).toBe(false);
    expect(r.motivos).toContain('saldo_nao_autorizado');
  });

  it('falha do Horizon nas contas propaga', async () => {
    accountsCall.mockRejectedValue(new Error('horizon 504'));
    await expect(conciliarAsset('PLINARF')).rejects.toThrow('horizon 504');
  });

  it('contas demais: erro, não confere por omissão', async () => {
    paginas({ PLINARF: Array.from({ length: 60 }, (_, i) => [conta(`G${i}`, 'PLINARF', '1')]) });
    const err = await conciliarAsset('PLINARF').catch((e: unknown) => e);
    expect((err as ConciliacaoError).code).toBe('CONCILIACAO_HISTORICO_EXCEDE_LIMITE');
  });

  it('code fora da Plina e chaves ausentes: recusa sem ir ao Horizon', async () => {
    expect(await conciliarAsset('USDC').catch((e: unknown) => e)).toBeInstanceOf(SupplyConfigError);
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', '');
    expect(await conciliarAsset('PLINARF').catch((e: unknown) => e)).toBeInstanceOf(SupplyConfigError);
    expect(accountsCall).not.toHaveBeenCalled();
  });
});

describe('exigirConciliacao (gate do snapshot)', () => {
  it('passa quando as duas classes conferem', async () => {
    paginas({ PLINARF: [[conta('GA', 'PLINARF', '600')]], PLINARFB: [[]] });
    const r = await exigirConciliacao();
    expect(r.senior.confere && r.subordinada.confere).toBe(true);
  });

  it('não publica se uma classe diverge', async () => {
    paginas({ PLINARF: [[conta('GA', 'PLINARF', '600')]], PLINARFB: [[conta('GZ', 'PLINARFB', '5')]] });
    const err = await exigirConciliacao().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConciliacaoError);
    expect((err as ConciliacaoError).code).toBe('CONCILIACAO_DIVERGENTE');
    expect((err as ConciliacaoError).detalhes?.map((d) => d.code)).toEqual(['PLINARFB']);
  });
});
