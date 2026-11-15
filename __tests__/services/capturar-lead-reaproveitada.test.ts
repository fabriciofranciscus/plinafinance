import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), audit: vi.fn(), memo: vi.fn() }));
vi.mock('@/lib/db', () => {
  const tx = { leadVendedor: { findUnique: m.findUnique, upsert: m.upsert }, eventoAudit: { create: m.audit } };
  return { db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(() => ({ x: 1 })), registerOnChainHash: m.memo }));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: vi.fn() }));

import { capturarLead } from '@/lib/services/originacao';

const base = { nome: 'Ana Souza', email: 'Ana@Exemplo.Test ', consentimentoLgpd: true };

beforeEach(() => {
  m.findUnique.mockReset().mockResolvedValue(null);
  m.upsert.mockReset().mockResolvedValue({ id: 'lead_1', status: 'NOVO' });
  m.audit.mockReset().mockResolvedValue({});
  m.memo.mockReset().mockResolvedValue({ payloadHash: 'h', txHash: 'tx' });
});

describe('capturarLead: aviso de solicitação reaproveitada (A-11)', () => {
  it('e-mail novo: reaproveitada=false, com o status do lead criado', async () => {
    const r = await capturarLead(base);
    expect(r).toMatchObject({ leadId: 'lead_1', reaproveitada: false, statusAtual: 'NOVO' });
    expect(m.findUnique.mock.calls[0][0].where).toEqual({ email: 'ana@exemplo.test' }); // mesmo e-mail normalizado do upsert
  });

  it('e-mail que já tem solicitação: reaproveitada=true, MESMO id e o status ATUAL (ex.: oferta enviada)', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1' });
    m.upsert.mockResolvedValue({ id: 'lead_1', status: 'OFERTA_ENVIADA' });
    expect(await capturarLead(base)).toMatchObject({ leadId: 'lead_1', reaproveitada: true, statusAtual: 'OFERTA_ENVIADA' });
  });

  it('lead PERDIDO reaproveitado também avisa e devolve o status PERDIDO (a tela decide o texto)', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1' });
    m.upsert.mockResolvedValue({ id: 'lead_1', status: 'PERDIDO' });
    expect(await capturarLead(base)).toMatchObject({ reaproveitada: true, statusAtual: 'PERDIDO' });
  });

  it('o comportamento de gravação não mudou: 1 upsert e 1 evento de consentimento por chamada', async () => {
    await capturarLead(base);
    expect(m.upsert).toHaveBeenCalledOnce();
    expect(m.audit).toHaveBeenCalledOnce();
    expect(m.audit.mock.calls[0][0].data.acao).toBe('LEAD_VENDEDOR_CAPTURADO');
  });
});
