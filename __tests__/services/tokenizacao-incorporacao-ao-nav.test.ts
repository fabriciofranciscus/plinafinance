import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma, StatusCota } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';

const m = vi.hoisted(() => ({
  cfg: { network: 'TESTNET' },
  issueAsset: vi.fn(),
  fetchSupplyDasClasses: vi.fn(),
  eventoFind: vi.fn(),
  eventoCreate: vi.fn(),
  cotaFindFirst: vi.fn(),
  cotaFindMany: vi.fn(),
  cotaFindUnique: vi.fn(),
  cotaCreate: vi.fn(),
  cotaUpdate: vi.fn(),
  movCreateMany: vi.fn(),
  movAggregate: vi.fn(),
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => m.cfg.network, enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({ issueAsset: m.issueAsset, executeClawback: vi.fn() }));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({}) }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: m.fetchSupplyDasClasses }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));
vi.mock('@/lib/db', () => {
  const tx = {
    cota: { update: m.cotaUpdate },
    eventoAudit: { create: m.eventoCreate },
    movimentoFundo: { createMany: m.movCreateMany },
  };
  return {
    db: {
      eventoAudit: { findFirst: m.eventoFind, create: m.eventoCreate },
      cota: { findFirst: m.cotaFindFirst, findMany: m.cotaFindMany, findUnique: m.cotaFindUnique, create: m.cotaCreate, update: m.cotaUpdate },
      movimentoFundo: { aggregate: m.movAggregate, createMany: m.movCreateMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import {
  IncorporacaoBloqueadaError,
  atualizarStatusCota,
  incorporarCota,
} from '@/lib/services/tokenizacao';
import { NavIndisponivelError, resetNavSupplyCache } from '@/lib/services/nav-supply';
import { navPorTokenAsDecimal } from '@/lib/services/pool';

const D = (v: string) => new Prisma.Decimal(v);
const supply = (c: string) => ({ circulante: D(c), tesouraria: D('0') }) as never;
const HASH = 'a'.repeat(64);
const POSICAO = Keypair.random().publicKey();

function evidencias(anuencia: 'CONFIRMADA' | 'DECLARADA_PENDENTE' | null = 'DECLARADA_PENDENTE', laudo = true) {
  m.eventoFind.mockImplementation(async ({ where }: { where: { acao: string } }) => {
    if (where.acao === 'COTA_VALIDADA') return laudo ? { stellarTxHash: 'txLaudo' } : null;
    if (where.acao === 'ANUENCIA_REGISTRADA') return anuencia ? { payloadJson: { hashValidacao: HASH, status: anuencia } } : null;
    return null;
  });
}

// cota nova de R$ 400 de custo: 500 × (1 − 0,20)
const base = {
  tipoBem: 'VEICULO' as never,
  administradora: 'X',
  valorCarta: '500',
  desagioAquisicao: '0.20',
  operador: 'admin',
  hashValidacao: HASH,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.STELLAR_ISSUER_SECRET = 'S-test';
  process.env.STELLAR_PLINA_POSITION_PUBLIC = POSICAO;
  m.cfg.network = 'TESTNET';
  resetNavSupplyCache();
  Object.values(m).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockReset?.());
  evidencias();
  m.issueAsset.mockResolvedValue({ hash: 'txEmissao' });
  m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
  m.cotaFindMany.mockResolvedValue([]);
  m.cotaFindFirst.mockResolvedValue(null);
  m.cotaCreate.mockResolvedValue({});
  m.cotaUpdate.mockResolvedValue({});
  m.eventoCreate.mockResolvedValue({});
  m.movAggregate.mockResolvedValue({ _sum: { deltaCaixa: null } });
  m.movCreateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe('incorporarCota — aporte ao NAV', () => {
  it('1ª incorporação com supply zero: R$ 400 → 400 PLINARF, para a posição da Plina, com code explícito', async () => {
    const r = await incorporarCota(base);
    expect(r.tokensEmitidos).toBe(400);
    const [, dest, amount, code] = m.issueAsset.mock.calls[0];
    expect(dest).toBe(POSICAO);
    expect(amount).toBe('400.0000000');
    expect(code).toBe('PLINARF');
  });

  it('NAV por token igual antes e depois do aporte (R$ 64.000 a NAV 1,041667 → 61.440 tokens)', async () => {
    const existente = { valorCarta: '312500', desagioAquisicao: '0.20', tokensEmitidos: '250000', status: StatusCota.DISPONIVEL };
    m.cotaFindMany.mockResolvedValue([existente]); // ativo 250.000
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('240000'), subordinada: supply('0') });
    const navAntes = navPorTokenAsDecimal([existente], [{ valorRealizado: 0 }], { circulante: '240000', tesouraria: '0' });
    expect(navAntes.toFixed(6)).toBe('1.041667');

    const r = await incorporarCota({ ...base, valorCarta: '80000', desagioAquisicao: '0.20' }); // V = 64.000
    const q = D(m.issueAsset.mock.calls[0][2]);
    expect(Math.round(r.tokensEmitidos)).toBe(61440);

    const novaCota = { valorCarta: '80000', desagioAquisicao: '0.20', tokensEmitidos: q.toString(), status: StatusCota.DISPONIVEL };
    const navDepois = navPorTokenAsDecimal([existente, novaCota], [{ valorRealizado: 0 }], {
      circulante: D('240000').plus(q),
      tesouraria: '0',
    });
    expect(navDepois.toFixed(6)).toBe(navAntes.toFixed(6));
    expect(navDepois.gte(navAntes.minus('0.00000001'))).toBe(true);
  });

  it('DB depois da chain: reserva EMISSAO_PENDENTE, emite, só então finaliza (cota + audit + APORTE_COTA)', async () => {
    const ordem: string[] = [];
    m.cotaCreate.mockImplementation(async () => { ordem.push('reserva'); return {}; });
    m.issueAsset.mockImplementation(async () => { ordem.push('chain'); return { hash: 'txEmissao' }; });
    m.cotaUpdate.mockImplementation(async () => { ordem.push('finaliza'); return {}; });
    await incorporarCota({ ...base, pixValorBrl: '400.00', pixHash: 'pixTx' });
    expect(ordem).toEqual(['reserva', 'chain', 'finaliza']);
    expect(m.cotaCreate.mock.calls[0][0].data.status).toBe('EMISSAO_PENDENTE');
    expect(m.cotaUpdate.mock.calls[0][0].data).toMatchObject({ status: 'DISPONIVEL', emissaoTxHash: 'txEmissao' });
    const acoes = m.eventoCreate.mock.calls.map((c) => c[0].data.acao);
    expect(acoes).toEqual(['COTA_INCORPORADA', 'TOKEN_EMITIDO']);
    const mov = m.movCreateMany.mock.calls[0][0].data[0];
    expect(mov).toMatchObject({ tipo: 'APORTE_COTA', refHash: 'pixTx', hashValidacao: HASH, txHash: 'txEmissao' });
    expect(mov.deltaCaixa.toString()).toBe('0'); // nunca AQUISICAO: o fundo não pagou a cota
    expect(mov.valorBrl.toFixed(2)).toBe('400.00');
    expect(mov.deltaTokens.toFixed(7)).toBe('400.0000000');
    expect(mov.navPorToken.toFixed(8)).toBe('1.00000000');
    expect(mov.chave).toMatch(/^aporte-cota:/);
  });

  it('falha on-chain: cota fica EMISSAO_PENDENTE, nada é finalizado e a mensagem não vaza segredo', async () => {
    m.issueAsset.mockRejectedValue(new Error('tx_bad_auth S-test-secret'));
    const err = await incorporarCota(base).catch((e) => e);
    expect(err.message).toMatch(/EMISSAO_PENDENTE/);
    expect(err.message).not.toMatch(/S-test|tx_bad_auth/);
    expect(m.cotaUpdate).not.toHaveBeenCalled();
    expect(m.movCreateMany).not.toHaveBeenCalled();
  });
});

describe('incorporarCota — emissão recusada (nada vai à chain)', () => {
  const recusa = async (input: Parameters<typeof incorporarCota>[0], code: string) => {
    const err = await incorporarCota(input).catch((e) => e);
    expect(err).toBeInstanceOf(IncorporacaoBloqueadaError);
    expect(err.code).toBe(code);
    expect(m.issueAsset).not.toHaveBeenCalled();
    expect(m.cotaCreate).not.toHaveBeenCalled();
  };

  it('sem hashValidacao', () => recusa({ ...base, hashValidacao: undefined }, 'LAUDO_AUSENTE'));
  it('hash sem laudo registrado', async () => { evidencias('CONFIRMADA', false); await recusa(base, 'LAUDO_AUSENTE'); });
  it('laudo sem anuência', async () => { evidencias(null); await recusa(base, 'ANUENCIA_AUSENTE'); });
  it('declarada pendente em mainnet', async () => { m.cfg.network = 'PUBLIC'; await recusa(base, 'ANUENCIA_PENDENTE_EM_MAINNET'); });
  it('laudo já usado por outra cota', async () => { m.cotaFindFirst.mockResolvedValue({ id: 'c0' }); await recusa(base, 'LAUDO_JA_USADO'); });
  it('sem conta de posição da Plina', async () => { delete process.env.STELLAR_PLINA_POSITION_PUBLIC; await recusa(base, 'POSICAO_PLINA_AUSENTE'); });
  it('conta de posição inválida também é recusada', async () => { process.env.STELLAR_PLINA_POSITION_PUBLIC = 'nao-e-chave'; await recusa(base, 'POSICAO_PLINA_AUSENTE'); });

  it('a mensagem de recusa é fixa e não cita nome de env nem valor', async () => {
    process.env.STELLAR_PLINA_POSITION_PUBLIC = 'valor-secreto-invalido';
    const err = await incorporarCota(base).catch((e) => e);
    expect(err.code).toBe('POSICAO_PLINA_AUSENTE');
    expect(err.message).not.toMatch(/STELLAR_|PLINA_POSITION|valor-secreto/);
  });
  it('Pix diferente do custo', () => recusa({ ...base, pixValorBrl: '390.00' }, 'PIX_DIVERGE_DO_CUSTO'));
  it('custo não positivo', () => recusa({ ...base, desagioAquisicao: '1' }, 'CUSTO_INVALIDO'));

  it('declarada pendente em testnet é aceita e fica registrada na cota', async () => {
    await incorporarCota(base);
    expect(m.cotaCreate.mock.calls[0][0].data.anuenciaStatus).toBe('DECLARADA_PENDENTE');
    expect(m.cotaCreate.mock.calls[0][0].data.hashValidacao).toBe(HASH);
  });

  it('anuência CONFIRMADA em mainnet é aceita', async () => {
    m.cfg.network = 'PUBLIC';
    evidencias('CONFIRMADA');
    await incorporarCota(base);
    expect(m.cotaCreate.mock.calls[0][0].data.anuenciaStatus).toBe('CONFIRMADA');
  });

  it('ledger fora → NavIndisponivelError, sem reservar cota nem emitir', async () => {
    m.fetchSupplyDasClasses.mockRejectedValue(new Error('x'));
    await expect(incorporarCota(base)).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(m.cotaCreate).not.toHaveBeenCalled();
    expect(m.issueAsset).not.toHaveBeenCalled();
  });

  it('PLINARFB circulando (D3) → recusa', async () => {
    m.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('0'), subordinada: supply('1') });
    await expect(incorporarCota(base)).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(m.issueAsset).not.toHaveBeenCalled();
  });
});

describe('atualizarStatusCota', () => {
  it('não entra nem sai de EMISSAO_PENDENTE por aqui', async () => {
    m.cotaFindUnique.mockResolvedValue({ status: 'DISPONIVEL' });
    await expect(atualizarStatusCota({ cotaId: 'c', status: 'EMISSAO_PENDENTE' as never, operador: 'a' })).rejects.toThrow(/EMISSAO_PENDENTE/);
    m.cotaFindUnique.mockResolvedValue({ status: 'EMISSAO_PENDENTE' });
    await expect(atualizarStatusCota({ cotaId: 'c', status: 'DISPONIVEL' as never, operador: 'a' })).rejects.toThrow(/EMISSAO_PENDENTE/);
    expect(m.cotaUpdate).not.toHaveBeenCalled();
  });
  it('transições normais continuam', async () => {
    m.cotaFindUnique.mockResolvedValue({ status: 'DISPONIVEL' });
    await atualizarStatusCota({ cotaId: 'c', status: 'REVERTIDA' as never, operador: 'a' });
    expect(m.cotaUpdate).toHaveBeenCalledOnce();
  });
});
