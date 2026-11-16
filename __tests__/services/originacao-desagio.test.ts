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

import { comporDesagioDaOferta, gerarOferta, OfertaInvalidaError } from '@/lib/services/originacao';

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

describe('prazo 0 = cota QUITADA (A-01) e a composição pura do deságio (A-08)', () => {
  const base = { valorCarta: '100000', administradora: 'Embracon Consórcios', desagioAquisicao: '0.18' };

  it('prazo 0 não soma componente de prazo (igual a não informar), mas é GUARDADO como 0 (não null)', async () => {
    await gerarOferta({ leadVendedorId: 'l_1', tipoBem: 'VEICULO', ...base, prazoRestanteMeses: 0, operador: 'op' });
    const data = ofertaCreate.mock.calls[0][0].data;
    expect(data.prazoRestanteMeses).toBe(0);
    expect(data.desagioAquisicao).toBe('0.1950'); // 0,18 + 150 bps de anuência, sem prazo
    expect(auditCreate.mock.calls[0][0].data.payloadJson).toMatchObject({ taxaPrazoBps: 0, prazoRestanteMeses: 0 });
  });

  it('sem prazo informado segue null no banco', async () => {
    await gerarOferta({ leadVendedorId: 'l_1', tipoBem: 'VEICULO', ...base, operador: 'op' });
    expect(ofertaCreate.mock.calls[0][0].data.prazoRestanteMeses).toBeNull();
  });

  it('comporDesagioDaOferta: prazo 12 meses soma 1500 bps; a composição bate com o que o gerarOferta grava', async () => {
    const c = comporDesagioDaOferta({ ...base, prazoRestanteMeses: 12 });
    expect(c.taxaPrazoBps).toBe(1500);
    expect(c.taxaAnuenciaBps).toBe(150);
    expect(c.desagioTotal.toFixed(4)).toBe('0.3450'); // 0,18 + 0,015 + 0,15
    expect(c.valorLiquido.toFixed(2)).toBe('65500.00');
    await gerarOferta({ leadVendedorId: 'l_1', tipoBem: 'VEICULO', ...base, prazoRestanteMeses: 12, operador: 'op' });
    const data = ofertaCreate.mock.calls[0][0].data;
    expect(data.desagioAquisicao).toBe(c.desagioTotal.toFixed(4));
    expect(data.valorLiquidoVendedor).toBe(c.valorLiquido.toFixed(2));
  });

  it('prazo 0 e prazo ausente dão a MESMA composição', () => {
    expect(comporDesagioDaOferta({ ...base, prazoRestanteMeses: 0 }).desagioTotal.toFixed(4)).toBe(
      comporDesagioDaOferta({ ...base }).desagioTotal.toFixed(4),
    );
  });

  it('caminho API_ADMINISTRADORA não tem taxa de anuência', () => {
    expect(comporDesagioDaOferta({ ...base, caminhoCessao: CaminhoCessao.API_ADMINISTRADORA }).taxaAnuenciaBps).toBe(0);
  });

  it('mesmas recusas de sempre: valor inválido, base fora de [0,1] e total acima de 100%', () => {
    expect(() => comporDesagioDaOferta({ ...base, valorCarta: '0' })).toThrow('valorCarta inválido');
    expect(() => comporDesagioDaOferta({ ...base, desagioAquisicao: '1.5' })).toThrow('fora de [0, 1]');
    expect(() => comporDesagioDaOferta({ ...base, desagioAquisicao: '0.95', prazoRestanteMeses: 12 })).toThrow('excede 100%');
  });

  it('as recusas são OfertaInvalidaError com código (A-22: a rota as devolve como 422, não 500)', () => {
    const erro = (f: () => unknown) => { try { f(); } catch (e) { return e; } return null; };
    const v = erro(() => comporDesagioDaOferta({ ...base, valorCarta: '0' }));
    const d = erro(() => comporDesagioDaOferta({ ...base, desagioAquisicao: '1.5' }));
    const t = erro(() => comporDesagioDaOferta({ ...base, desagioAquisicao: '0.95', prazoRestanteMeses: 12 }));
    expect(v).toBeInstanceOf(OfertaInvalidaError);
    expect((v as OfertaInvalidaError).code).toBe('VALOR_CARTA_INVALIDO');
    expect((d as OfertaInvalidaError).code).toBe('DESAGIO_BASE_INVALIDO');
    expect((t as OfertaInvalidaError).code).toBe('DESAGIO_TOTAL_EXCEDE');
    expect((t as OfertaInvalidaError).message).toBe('O deságio total (base + anuência + prazo) excede 100%. Revise os dados da proposta.');
    // neutra: não orienta a alterar prazo nem deságio para passar na validação
    expect((t as OfertaInvalidaError).message).not.toMatch(/reduza|prazo restante/i);
  });
});

describe('gerarOferta · lead inexistente (G5: 404 com code, não 500)', () => {
  const entrada = { leadVendedorId: 'l_x', tipoBem: 'VEICULO' as const, valorCarta: '100000', administradora: 'Embracon Consórcios', desagioAquisicao: '0.18', operador: 'op' };
  it.each(['P2003', 'P2025'])('erro %s do banco vira LEAD_NAO_ENCONTRADO (404) com mensagem fixa', async (codigo) => {
    const { Prisma } = await import('@prisma/client');
    ofertaCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('FK com o id do lead dentro', { code: codigo, clientVersion: 'x' }));
    await expect(gerarOferta(entrada)).rejects.toMatchObject({ code: 'LEAD_NAO_ENCONTRADO', status: 404, message: 'Lead não encontrado' });
    expect(auditCreate).not.toHaveBeenCalled();
  });
  it('outro erro do banco segue como está (não mascara falha)', async () => {
    ofertaCreate.mockRejectedValue(new Error('conexão caiu'));
    await expect(gerarOferta(entrada)).rejects.toThrow('conexão caiu');
  });
});
