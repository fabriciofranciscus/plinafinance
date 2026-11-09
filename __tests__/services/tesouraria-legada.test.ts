import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ saldos: vi.fn(), find: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSaldoTesourariaDasClasses: m.saldos }));
vi.mock('@/lib/db', () => ({ db: { eventoAudit: { findFirst: m.find, create: m.create } } }));

import { registrarTesourariaLegada } from '@/lib/services/tesouraria-legada';

const D = (v: string) => new Prisma.Decimal(v);
const saldo = (code: string, v: string) => ({
  code, issuer: 'GISS', distributor: 'GDIST', saldo: D(v), temTrustline: true, autorizada: true, lidoEm: new Date('2026-11-09T23:30:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  m.saldos.mockResolvedValue({ senior: saldo('PLINARF', '2539554.3335618'), subordinada: saldo('PLINARFB', '0') });
  m.find.mockResolvedValue(null);
  m.create.mockResolvedValue({});
});

describe('registrarTesourariaLegada (TES-1)', () => {
  it('grava um EventoAudit por classe com o saldo real, sem movimento on-chain e sem MovimentoFundo', async () => {
    const r = await registrarTesourariaLegada({ operador: 'adm' });
    expect(r.posicoes).toEqual([
      { code: 'PLINARF', saldo: '2539554.3335618', registrado: true },
      { code: 'PLINARFB', saldo: '0.0000000', registrado: true },
    ]);
    const d = m.create.mock.calls[0][0].data;
    expect(d.acao).toBe('TESOURARIA_LEGADA_REGISTRADA');
    expect(d.payloadJson).toMatchObject({
      code: 'PLINARF',
      saldo: '2539554.3335618',
      classificacao: 'POSICAO_DA_PLINA',
      movimentoOnChain: false,
    });
    expect(Object.keys(d)).not.toContain('stellarTxHash');
  });

  it('idempotente: mesmo saldo não duplica; saldo novo gera novo evento', async () => {
    m.find.mockResolvedValueOnce({ payloadJson: { saldo: '2539554.3335618' } }).mockResolvedValueOnce({ payloadJson: { saldo: '0.0000000' } });
    const r = await registrarTesourariaLegada({ operador: 'adm' });
    expect(r.posicoes.map((p) => p.registrado)).toEqual([false, false]);
    expect(m.create).not.toHaveBeenCalled();

    m.find.mockResolvedValueOnce({ payloadJson: { saldo: '2000000.0000000' } }).mockResolvedValueOnce(null);
    const r2 = await registrarTesourariaLegada({ operador: 'adm' });
    expect(r2.posicoes[0].registrado).toBe(true);
  });

  it('falha ao ler o Horizon → não registra nada (fail-closed)', async () => {
    m.saldos.mockRejectedValue(new Error('horizon down'));
    await expect(registrarTesourariaLegada({ operador: 'adm' })).rejects.toThrow();
    expect(m.create).not.toHaveBeenCalled();
  });
});
