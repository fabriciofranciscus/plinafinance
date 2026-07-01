import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CaminhoCessao } from '@prisma/client';

const { ofertaCount, ofertaCreate, leadUpdate, auditCreate, leadFindUnique } =
  vi.hoisted(() => ({
    ofertaCount: vi.fn(),
    ofertaCreate: vi.fn(),
    leadUpdate: vi.fn(),
    auditCreate: vi.fn(),
    leadFindUnique: vi.fn(),
  }));

vi.mock('@/lib/db', () => ({
  db: {
    oferta: { count: ofertaCount },
    leadVendedor: { findUnique: leadFindUnique },
    $transaction: async (
      cb: (tx: {
        oferta: { create: typeof ofertaCreate };
        leadVendedor: { update: typeof leadUpdate };
        eventoAudit: { create: typeof auditCreate };
      }) => Promise<unknown>,
    ) =>
      cb({
        oferta: { create: ofertaCreate },
        leadVendedor: { update: leadUpdate },
        eventoAudit: { create: auditCreate },
      }),
  },
}));

vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: vi.fn() }));

import { gerarOferta } from '@/lib/services/originacao';

beforeEach(() => {
  ofertaCount.mockReset().mockResolvedValue(0);
  ofertaCreate.mockReset().mockResolvedValue({ id: 'of_1' });
  leadUpdate.mockReset().mockResolvedValue({});
  auditCreate.mockReset().mockResolvedValue({});
  leadFindUnique.mockReset().mockResolvedValue({ email: 'c@x.com', nome: 'Ricardo' });
});

describe('gerarOferta · taxa de anuência (F-M1-4)', () => {
  it('fallback (CARTORIO_DIGITAL) embute a taxa no deságio', async () => {
    await gerarOferta({
      leadVendedorId: 'l_1',
      tipoBem: 'VEICULO',
      valorCarta: '100000',
      administradora: 'Embracon Consórcios', // 150 bps
      desagioAquisicao: '0.18',
      operador: 'op',
    });
    const data = ofertaCreate.mock.calls[0][0].data;
    // 0.18 + 0.015 = 0.1950
    expect(data.desagioAquisicao).toBe('0.1950');
    // 100000 * (1 - 0.195) = 80500.00
    expect(data.valorLiquidoVendedor).toBe('80500.00');
  });

  it('API_ADMINISTRADORA não cobra taxa', async () => {
    await gerarOferta({
      leadVendedorId: 'l_1',
      tipoBem: 'VEICULO',
      valorCarta: '100000',
      administradora: 'Embracon Consórcios',
      desagioAquisicao: '0.18',
      operador: 'op',
      caminhoCessao: CaminhoCessao.API_ADMINISTRADORA,
    });
    const data = ofertaCreate.mock.calls[0][0].data;
    expect(data.desagioAquisicao).toBe('0.1800');
    expect(data.valorLiquidoVendedor).toBe('82000.00');
  });
});

describe('gerarOferta · componente de prazo (curva de yield provisória, §3.4)', () => {
  it('soma o componente de prazo (linear, 15% a.a.) ao deságio', async () => {
    await gerarOferta({
      leadVendedorId: 'l_1',
      tipoBem: 'VEICULO',
      valorCarta: '100000',
      administradora: 'Embracon Consórcios', // 150 bps
      desagioAquisicao: '0.18',
      operador: 'op',
      prazoRestanteMeses: 12, // 125 bps/mês × 12 = 1500 bps = 0.15
    });
    const data = ofertaCreate.mock.calls[0][0].data;
    // 0.18 + 0.015 (anuência) + 0.15 (prazo) = 0.3450
    expect(data.desagioAquisicao).toBe('0.3450');
    expect(data.valorLiquidoVendedor).toBe('65500.00');
    expect(data.prazoRestanteMeses).toBe(12);
  });

  it('sem prazo informado, componente de prazo é zero (compatibilidade)', async () => {
    await gerarOferta({
      leadVendedorId: 'l_1',
      tipoBem: 'VEICULO',
      valorCarta: '100000',
      administradora: 'Embracon Consórcios',
      desagioAquisicao: '0.18',
      operador: 'op',
    });
    const data = ofertaCreate.mock.calls[0][0].data;
    expect(data.desagioAquisicao).toBe('0.1950');
  });

  it('grava taxaPrazoBps e prazoRestanteMeses no payload de auditoria', async () => {
    await gerarOferta({
      leadVendedorId: 'l_1',
      tipoBem: 'VEICULO',
      valorCarta: '100000',
      administradora: 'Embracon Consórcios',
      desagioAquisicao: '0.18',
      operador: 'op',
      prazoRestanteMeses: 12,
    });
    const auditPayload = auditCreate.mock.calls[0][0].data.payloadJson;
    expect(auditPayload.taxaPrazoBps).toBe(1500);
    expect(auditPayload.prazoRestanteMeses).toBe(12);
  });
});
