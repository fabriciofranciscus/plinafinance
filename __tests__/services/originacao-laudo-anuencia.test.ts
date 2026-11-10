import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
  cfg: { network: 'TESTNET' },
  cessaoFind: vi.fn(),
  eventoFind: vi.fn(),
  eventoCreate: vi.fn(),
  registerOnChainHash: vi.fn(),
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => m.cfg.network, enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/audit', () => ({
  buildAuditPayload: (tipo: string, id: string, extra: object) => ({ tipo, id, ...extra }),
  registerOnChainHash: m.registerOnChainHash,
  sha256OfPayload: vi.fn(),
}));
vi.mock('@/lib/services/tokenizacao', () => ({ incorporarCota: vi.fn() }));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: vi.fn() }));
vi.mock('@/lib/comprovante/pdf', () => ({ buildComprovantePdf: vi.fn() }));
vi.mock('@/lib/comprovante/store', () => ({ uploadComprovante: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    cessao: { findUnique: m.cessaoFind },
    eventoAudit: { findFirst: m.eventoFind, create: m.eventoCreate },
  },
}));

import { registrarAnuencia, registrarLaudoDaCessao } from '@/lib/services/originacao';

const HASH = 'b'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  m.cfg.network = 'TESTNET';
  m.cessaoFind.mockResolvedValue({ id: 'ces_1', oferta: { administradora: 'X', tipoBem: 'VEICULO' }, cota: null });
  m.registerOnChainHash.mockResolvedValue({ payloadHash: HASH, txHash: 'txL' });
  m.eventoCreate.mockResolvedValue({});
  m.eventoFind.mockResolvedValue({ id: 'ev1', cessaoId: 'ces_1', cotaId: null });
});
afterEach(() => vi.restoreAllMocks());

describe('registrarLaudoDaCessao', () => {
  it('grava memo + COTA_VALIDADA ligado à cessão e devolve o hashValidacao', async () => {
    const r = await registrarLaudoDaCessao({ cessaoId: 'ces_1', laudoUrl: 'https://x.test/laudo.pdf', operador: 'adm' });
    expect(r).toEqual({ cessaoId: 'ces_1', hashValidacao: HASH, txHash: 'txL' });
    expect(m.eventoCreate.mock.calls[0][0].data).toMatchObject({ acao: 'COTA_VALIDADA', cessaoId: 'ces_1', payloadHash: HASH });
  });

  it('recusa URL inválida, cessão inexistente e cessão já incorporada — sem tocar a chain', async () => {
    await expect(registrarLaudoDaCessao({ cessaoId: 'c', laudoUrl: 'ftp://x', operador: 'a' })).rejects.toThrow(/laudoUrl/);
    m.cessaoFind.mockResolvedValueOnce(null);
    await expect(registrarLaudoDaCessao({ cessaoId: 'c', laudoUrl: 'https://x.test', operador: 'a' })).rejects.toThrow(/não encontrada/);
    m.cessaoFind.mockResolvedValueOnce({ id: 'c', oferta: {}, cota: { id: 'k' } });
    await expect(registrarLaudoDaCessao({ cessaoId: 'c', laudoUrl: 'https://x.test', operador: 'a' })).rejects.toThrow(/já tem cota/);
    expect(m.registerOnChainHash).not.toHaveBeenCalled();
  });
});

describe('registrarAnuencia', () => {
  it('DECLARADA_PENDENTE em testnet fica registrada, sem fingir confirmação', async () => {
    const r = await registrarAnuencia({ hashValidacao: HASH, status: 'DECLARADA_PENDENTE', operador: 'adm' });
    expect(r.status).toBe('DECLARADA_PENDENTE');
    expect(m.eventoCreate.mock.calls[0][0].data).toMatchObject({
      acao: 'ANUENCIA_REGISTRADA',
      cessaoId: 'ces_1',
      payloadJson: { hashValidacao: HASH, status: 'DECLARADA_PENDENTE', referencia: null },
    });
  });

  it('DECLARADA_PENDENTE é recusada em mainnet', async () => {
    m.cfg.network = 'PUBLIC';
    await expect(registrarAnuencia({ hashValidacao: HASH, status: 'DECLARADA_PENDENTE', operador: 'a' })).rejects.toThrow(/mainnet/);
    expect(m.eventoCreate).not.toHaveBeenCalled();
  });

  it('CONFIRMADA exige referência', async () => {
    await expect(registrarAnuencia({ hashValidacao: HASH, status: 'CONFIRMADA', operador: 'a' })).rejects.toThrow(/referência/);
    await registrarAnuencia({ hashValidacao: HASH, status: 'CONFIRMADA', referencia: 'prot-123', operador: 'a' });
    expect(m.eventoCreate.mock.calls[0][0].data.payloadJson.referencia).toBe('prot-123');
  });

  it('recusa anuência de laudo inexistente', async () => {
    m.eventoFind.mockResolvedValue(null);
    await expect(registrarAnuencia({ hashValidacao: HASH, status: 'DECLARADA_PENDENTE', operador: 'a' })).rejects.toThrow(/Laudo não registrado/);
  });
});
