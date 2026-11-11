import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const { criarReserva, resolverLead, verifyPrivyTokenLite, pessoaFind } = vi.hoisted(() => ({
  criarReserva: vi.fn(),
  resolverLead: vi.fn(),
  verifyPrivyTokenLite: vi.fn(),
  pessoaFind: vi.fn(),
}));

vi.mock('@/lib/services/realizacao', () => ({
  criarReserva,
  resolverLeadCompradorPorPessoa: resolverLead,
}));
vi.mock('@/lib/db', () => ({ db: { pessoa: { findUnique: pessoaFind } } }));
vi.mock('@/lib/wallet/privy', () => ({ verifyPrivyTokenLite }));

import { POST } from '@/app/api/comprar/reserva/route';
import { leadLimiter } from '@/lib/rate-limit/config';

function req(body: unknown): Request {
  return new Request('http://x/api/comprar/reserva', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await leadLimiter.reset();
  verifyPrivyTokenLite.mockResolvedValue({ userId: 'did:privy:1', email: 'a@b.co' });
  pessoaFind.mockResolvedValue({
    id: 'pes_1',
    nome: 'Ana',
    publicKey: 'GABC',
    papeis: [],
    kycAprovado: false,
    kycStatus: 'NAO_INICIADO',
    etherfuseCustomerId: null,
  });
  resolverLead.mockResolvedValue({ id: 'lead_1' });
  criarReserva.mockResolvedValue({
    reservaId: 'res_1',
    expiraEm: new Date('2026-11-12T10:00:00Z'),
    txHash: 'tx_1',
    payloadHash: 'ph_1',
  });
});

describe('reserva — rota única', () => {
  it('só existe /api/comprar/reserva; /reservar foi removida', () => {
    const base = join(process.cwd(), 'app/api/comprar');
    expect(existsSync(join(base, 'reserva/route.ts'))).toBe(true);
    expect(existsSync(join(base, 'reservar'))).toBe(false);
  });

  it('200 com o contrato { reservaId, expiraEm, txHash, payloadHash }', async () => {
    const r = await POST(req({ cotaId: 'c1', sinalSimulado: '1000' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      reservaId: 'res_1',
      expiraEm: '2026-11-12T10:00:00.000Z',
      txHash: 'tx_1',
      payloadHash: 'ph_1',
    });
  });

  it('uma chamada = uma criarReserva (1 memo por ciclo), lead derivado da sessão', async () => {
    await POST(req({ cotaId: 'c1' }));
    expect(criarReserva).toHaveBeenCalledTimes(1);
    expect(criarReserva).toHaveBeenCalledWith({
      cotaId: 'c1',
      leadCompradorId: 'lead_1',
      sinalSimulado: undefined,
    });
    expect(resolverLead).toHaveBeenCalledWith({ pessoaId: 'pes_1', email: 'a@b.co', nome: 'Ana' });
  });

  it('401 sem sessão, sem tocar no serviço', async () => {
    verifyPrivyTokenLite.mockRejectedValueOnce(new Error('expired'));
    const r = await POST(req({ cotaId: 'c1' }));
    expect(r.status).toBe(401);
    expect(criarReserva).not.toHaveBeenCalled();
  });

  it('400 para body com leadCompradorId (IDOR) ou campo extra — strict', async () => {
    expect((await POST(req({ cotaId: 'c1', leadCompradorId: 'lead_outro' }))).status).toBe(400);
    expect(criarReserva).not.toHaveBeenCalled();
  });

  it('400 para sinalSimulado acima do limite do contrato (20)', async () => {
    expect((await POST(req({ cotaId: 'c1', sinalSimulado: '1'.repeat(21) }))).status).toBe(400);
    expect((await POST(req({ cotaId: 'c1', sinalSimulado: '1'.repeat(20) }))).status).toBe(200);
  });

  it('409 quando a cota não é reservável', async () => {
    criarReserva.mockRejectedValueOnce(new Error('Cota em estado RESERVADA — não reservável'));
    expect((await POST(req({ cotaId: 'c1' }))).status).toBe(409);
  });
});
