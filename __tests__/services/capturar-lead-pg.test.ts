/**
 * capturarLead contra o Postgres REAL (A-11): o reenvio não ancora de novo, grava LEAD_VENDEDOR_REAPROVEITADO (valor novo do
 * enum) e o lead segue único. Só roda com TEST_PG_URL local (migrations aplicadas); o memo on-chain é simulado.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});
const memo = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/stellar/audit', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/audit')>()),
  registerOnChainHash: vi.fn(async () => ({ payloadHash: `hash${++memo.n}`, txHash: `tx${memo.n}` })),
}));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: vi.fn() }));

import { db } from '@/lib/db';
import { capturarLead } from '@/lib/services/originacao';

const base = { nome: 'Ana Souza', email: 'ana-pg@exemplo.test', consentimentoLgpd: true, origem: 'wizard-vender' };

describe.skipIf(!PG)('capturarLead — Postgres real', () => {
  beforeAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE "EventoAudit","LeadVendedor" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('1ª captura ancora; o reenvio (mesma versão) NÃO ancora, grava REAPROVEITADO e devolve a mesma âncora', async () => {
    const a = await capturarLead(base);
    expect(a).toMatchObject({ reaproveitada: false, payloadHash: 'hash1', txHash: 'tx1', statusAtual: 'NOVO' });
    const b = await capturarLead({ ...base, telefone: '11999990000' });
    expect(b).toMatchObject({ leadId: a.leadId, reaproveitada: true, payloadHash: 'hash1', txHash: 'tx1' });
    expect(memo.n).toBe(1); // um único memo on-chain
    const c = await capturarLead(base);
    expect(c.leadId).toBe(a.leadId);
    expect(memo.n).toBe(1);

    expect(await db.leadVendedor.count()).toBe(1);
    const eventos = await db.eventoAudit.findMany({ where: { leadVendedorId: a.leadId }, orderBy: { criadoEm: 'asc' } });
    expect(eventos.map((e) => e.acao)).toEqual(['LEAD_VENDEDOR_CAPTURADO', 'LEAD_VENDEDOR_REAPROVEITADO', 'LEAD_VENDEDOR_REAPROVEITADO']);
    expect(eventos[1]).toMatchObject({ payloadHash: null, stellarTxHash: null });
    expect(eventos[1].payloadJson).toMatchObject({ camposAtualizados: ['telefone'] });
    expect(JSON.stringify(eventos[1].payloadJson)).not.toMatch(/ana|exemplo|11999990000/i);
  });

  it('mudou a versão do texto no evento anterior: ancora de novo (2º memo) e o lead continua único', async () => {
    await db.$executeRawUnsafe(`UPDATE "EventoAudit" SET "payloadJson" = jsonb_set("payloadJson", '{versaoConsentimento}', '"antiga"') WHERE acao = 'LEAD_VENDEDOR_CAPTURADO'`);
    const r = await capturarLead(base);
    expect(r).toMatchObject({ reaproveitada: true, payloadHash: 'hash2' });
    expect(memo.n).toBe(2);
    expect(await db.leadVendedor.count()).toBe(1);
  });
});
