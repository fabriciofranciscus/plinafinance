import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), audit: vi.fn(), ultimoEvento: vi.fn(), memo: vi.fn(), rede: 'TESTNET',
}));
vi.mock('@/lib/db', () => {
  const tx = { leadVendedor: { update: m.update, upsert: m.upsert }, eventoAudit: { create: m.audit } };
  return {
    db: {
      leadVendedor: { findUnique: m.findUnique },
      eventoAudit: { findFirst: m.ultimoEvento },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/stellar/audit', () => ({
  buildAuditPayload: vi.fn((_t: string, _r: unknown, d: Record<string, unknown>) => ({ _at: '2026-11-15T10:00:00Z', ...d })),
  registerOnChainHash: m.memo,
}));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: vi.fn() }));
vi.mock('@/lib/stellar/config', async (orig) => {
  const mod = { ...(await orig<typeof import('@/lib/stellar/config')>()) } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => m.rede, enumerable: true });
  return mod;
});

import { capturarLead } from '@/lib/services/originacao';
import * as consent from '@/lib/vender/consentimento';

const SEGREDO = 's'.repeat(40);
const base = { nome: 'Ana Souza', email: 'Ana@Exemplo.Test ', consentimentoLgpd: true, origem: 'wizard-vender' };
const eventoAnterior = (over: Record<string, unknown> = {}) => ({
  payloadJson: { versaoConsentimento: consent.VERSAO_CONSENTIMENTO_LGPD, origem: 'wizard-vender' },
  payloadHash: 'hash_1', stellarTxHash: 'tx_1', ...over,
});

beforeEach(() => {
  m.rede = 'TESTNET';
  delete process.env.CONSENTIMENTO_HMAC_SECRET;
  m.findUnique.mockReset().mockResolvedValue(null);
  m.update.mockReset().mockResolvedValue({ id: 'lead_1', status: 'OFERTA_ENVIADA' });
  m.upsert.mockReset().mockResolvedValue({ id: 'lead_1', status: 'NOVO' });
  m.audit.mockReset().mockResolvedValue({});
  m.ultimoEvento.mockReset().mockResolvedValue(null);
  m.memo.mockReset().mockResolvedValue({ payloadHash: 'h_novo', txHash: 'tx_novo' });
});

describe('capturarLead — âncora do consentimento só na 1ª vez ou quando a versão muda (A-11)', () => {
  it('lead novo: ancora, reaproveitada=false e o payload leva a VERSÃO (hash do texto)', async () => {
    const r = await capturarLead(base);
    expect(r).toMatchObject({ leadId: 'lead_1', reaproveitada: false, statusAtual: 'NOVO', payloadHash: 'h_novo', txHash: 'tx_novo' });
    expect(m.memo).toHaveBeenCalledOnce();
    expect(m.memo.mock.calls[0][0]).toMatchObject({ versaoConsentimento: consent.VERSAO_CONSENTIMENTO_LGPD, consentimentoLgpd: true });
    expect(m.audit.mock.calls[0][0].data.acao).toBe('LEAD_VENDEDOR_CAPTURADO');
  });

  it('reenvio com a MESMA versão e origem: NÃO ancora (sem memo, sem fee), grava LEAD_VENDEDOR_REAPROVEITADO e devolve a âncora existente', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana Souza', telefone: null });
    m.ultimoEvento.mockResolvedValue(eventoAnterior());
    const r = await capturarLead(base);
    expect(m.memo).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(r).toMatchObject({ leadId: 'lead_1', reaproveitada: true, statusAtual: 'OFERTA_ENVIADA', payloadHash: 'hash_1', txHash: 'tx_1' });
    const ev = m.audit.mock.calls[0][0].data;
    expect(ev.acao).toBe('LEAD_VENDEDOR_REAPROVEITADO');
    expect(ev.payloadHash).toBeUndefined(); // append-only, sem memo
    expect(ev.stellarTxHash).toBeUndefined();
    expect(ev.payloadJson).toEqual({ versaoConsentimento: consent.VERSAO_CONSENTIMENTO_LGPD, statusAtual: 'OFERTA_ENVIADA', camposAtualizados: [] });
  });

  it('o evento do reaproveitamento não leva PII (nem e-mail, nem nome, nem telefone, nem valores)', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Outro Nome', telefone: '1111' });
    m.ultimoEvento.mockResolvedValue(eventoAnterior());
    await capturarLead({ ...base, telefone: '11999990000' });
    const json = JSON.stringify(m.audit.mock.calls[0][0].data);
    expect(json).not.toMatch(/ana|exemplo|Souza|11999990000|1111/i);
    expect(m.audit.mock.calls[0][0].data.payloadJson.camposAtualizados).toEqual(['nome', 'telefone']); // só os NOMES dos campos
  });

  it('VERSÃO do texto mudou: ancora de novo (consentimento novo) e reaproveitada=true (o lead já existia)', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana Souza', telefone: null });
    m.ultimoEvento.mockResolvedValue(eventoAnterior({ payloadJson: { versaoConsentimento: 'b'.repeat(64), origem: 'wizard-vender' } }));
    const r = await capturarLead(base);
    expect(m.memo).toHaveBeenCalledOnce();
    expect(m.audit.mock.calls[0][0].data.acao).toBe('LEAD_VENDEDOR_CAPTURADO');
    expect(r).toMatchObject({ reaproveitada: true, payloadHash: 'h_novo' });
  });

  it('ORIGEM mudou: ancora de novo', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana Souza', telefone: null });
    m.ultimoEvento.mockResolvedValue(eventoAnterior());
    await capturarLead({ ...base, origem: 'landing-parceiro' });
    expect(m.memo).toHaveBeenCalledOnce();
  });

  it("lead ANTIGO (evento sem versão = 'legado'): reancora UMA vez com o texto de hoje, sem tentar reconstruir o antigo", async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana Souza', telefone: null });
    m.ultimoEvento.mockResolvedValue(eventoAnterior({ payloadJson: { email: 'ana@exemplo.test', consentimentoLgpd: true, origem: 'wizard-vender' } }));
    await capturarLead(base);
    expect(m.memo).toHaveBeenCalledOnce();
    expect(m.memo.mock.calls[0][0].versaoConsentimento).toBe(consent.VERSAO_CONSENTIMENTO_LGPD);
  });

  it('lead existente SEM evento de captura (ou sem hash/tx): ancora (é a 1ª captura registrada dele)', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana Souza', telefone: null });
    m.ultimoEvento.mockResolvedValue(null);
    await capturarLead(base);
    expect(m.memo).toHaveBeenCalledOnce();
    m.memo.mockClear();
    m.ultimoEvento.mockResolvedValue(eventoAnterior({ stellarTxHash: null }));
    await capturarLead(base);
    expect(m.memo).toHaveBeenCalledOnce();
  });

  it('nome e telefone mudam SEM nova âncora e o evento lista quais campos mudaram', async () => {
    m.findUnique.mockResolvedValue({ id: 'lead_1', nome: 'Ana S.', telefone: '1' });
    m.ultimoEvento.mockResolvedValue(eventoAnterior());
    await capturarLead({ ...base, telefone: '2' });
    expect(m.memo).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0][0].data).toMatchObject({ nome: 'Ana Souza', telefone: '2' });
    expect(m.audit.mock.calls[0][0].data.payloadJson.camposAtualizados).toEqual(['nome', 'telefone']);
  });
});

describe('capturarLead — o titular vai como PSEUDÔNIMO, não o e-mail em claro (Consuelo 2)', () => {
  it('com CONSENTIMENTO_HMAC_SECRET: payload ancorado tem `titular` (HMAC do e-mail normalizado) e NÃO tem o e-mail', async () => {
    process.env.CONSENTIMENTO_HMAC_SECRET = SEGREDO;
    await capturarLead(base);
    const p = m.memo.mock.calls[0][0];
    expect(p.titular).toBe(consent.pseudonimoDoTitular('ana@exemplo.test', SEGREDO));
    expect(p.titular).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(p)).not.toMatch(/ana@|exemplo/i);
    expect(JSON.stringify(m.audit.mock.calls[0][0].data.payloadJson)).not.toMatch(/ana@|exemplo/i);
  });
  it('sem segredo, na testnet: cai no e-mail em claro (comportamento anterior) e não leva `titular`', async () => {
    await capturarLead(base);
    expect(m.memo.mock.calls[0][0]).toMatchObject({ email: 'ana@exemplo.test' });
    expect(m.memo.mock.calls[0][0].titular).toBeUndefined();
  });
  it('MAINNET fail-closed: sem texto aprovado ou sem segredo, recusa ANTES de qualquer âncora ou gravação', async () => {
    m.rede = 'PUBLIC';
    process.env.CONSENTIMENTO_HMAC_SECRET = SEGREDO;
    await expect(capturarLead(base)).rejects.toThrow(/Consentimento indisponível/); // texto ainda não aprovado
    expect(consent.TEXTO_CONSENTIMENTO_APROVADO).toBe(false);
    delete process.env.CONSENTIMENTO_HMAC_SECRET;
    await expect(capturarLead(base)).rejects.toThrow(/Consentimento indisponível/);
    expect(m.memo).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });
});

describe('módulo de consentimento', () => {
  it('a versão é o SHA-256 do TEXTO exato (muda com uma letra)', () => {
    expect(consent.VERSAO_CONSENTIMENTO_LGPD).toBe(createHash('sha256').update(consent.TEXTO_CONSENTIMENTO_LGPD, 'utf8').digest('hex'));
    expect(createHash('sha256').update(consent.TEXTO_CONSENTIMENTO_LGPD + '.', 'utf8').digest('hex')).not.toBe(consent.VERSAO_CONSENTIMENTO_LGPD);
  });
  it('pseudônimo: determinístico, depende do e-mail e do segredo; segredo curto/ausente → null', () => {
    const a = consent.pseudonimoDoTitular('a@x.test', SEGREDO);
    expect(a).toBe(consent.pseudonimoDoTitular('a@x.test', SEGREDO));
    expect(a).not.toBe(consent.pseudonimoDoTitular('b@x.test', SEGREDO));
    expect(a).not.toBe(consent.pseudonimoDoTitular('a@x.test', 't'.repeat(40)));
    for (const s of [undefined, '', 'curto', 'x'.repeat(31)]) expect(consent.pseudonimoDoTitular('a@x.test', s)).toBeNull();
  });
});
