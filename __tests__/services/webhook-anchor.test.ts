import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  weCreate: vi.fn(),
  weFind: vi.fn(),
  weUpdate: vi.fn(),
  pessoaFind: vi.fn(),
  pessoaUpdate: vi.fn(),
  invUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    pessoa: { update: m.pessoaUpdate },
    investidor: { updateMany: m.invUpdateMany },
    eventoAudit: { create: m.auditCreate },
  };
  return {
    db: {
      webhookEvento: { create: m.weCreate, findUnique: m.weFind, update: m.weUpdate },
      pessoa: { findFirst: m.pessoaFind },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { processarWebhookAnchor } from '@/lib/services/webhook-anchor';
import type { AnchorWebhookEvent } from '@/lib/anchors/webhook';

function evt(over: Partial<AnchorWebhookEvent> = {}, payload: AnchorWebhookEvent['payload'] = {}): AnchorWebhookEvent {
  return {
    fornecedor: 'etherfuse',
    eventoId: 'e1',
    tipo: 'kyc_updated',
    recursoId: 'cust_1',
    status: 'approved',
    payload: { recursoId: 'cust_1', status: 'approved', approved: true, needsWork: false, ...payload },
    userMessage: null,
    ...over,
  };
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

beforeEach(() => {
  vi.clearAllMocks();
  m.weCreate.mockResolvedValue({ id: 'we_1' });
  m.weUpdate.mockResolvedValue({});
  m.pessoaFind.mockResolvedValue({ id: 'p1', privyId: 'did:privy:1', kycStatus: 'PENDENTE' });
});

describe('processarWebhookAnchor', () => {
  it('kyc approved: atualiza Pessoa, promove Investidor, audita e carimba processadoEm', async () => {
    const r = await processarWebhookAnchor(evt());
    expect(r).toEqual({ duplicado: false, processado: true });
    expect(m.pessoaUpdate.mock.calls[0][0].data).toMatchObject({
      kycStatus: 'APROVADO',
      kycAprovado: true,
      kycNeedsWork: false,
      kycUserMessage: null,
    });
    expect(m.invUpdateMany).toHaveBeenCalledWith({
      where: { pessoaId: 'p1', status: 'PENDENTE_KYC' },
      data: { kycAprovado: true, status: 'AUTORIZADO' },
    });
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ acao: 'KYC_ATUALIZADO_WEBHOOK' });
    expect(m.weUpdate.mock.calls[0][0].data.processadoEm).toBeInstanceOf(Date);
  });

  it('entrega duplicada já processada: não reaplica o efeito', async () => {
    m.weCreate.mockRejectedValueOnce(p2002());
    m.weFind.mockResolvedValueOnce({ id: 'we_1', processadoEm: new Date() });
    const r = await processarWebhookAnchor(evt());
    expect(r).toEqual({ duplicado: true, processado: false });
    expect(m.pessoaUpdate).not.toHaveBeenCalled();
  });

  it('entrega que falhou antes (sem processadoEm) é reprocessada no reenvio', async () => {
    m.weCreate.mockRejectedValueOnce(p2002());
    m.weFind.mockResolvedValueOnce({ id: 'we_1', processadoEm: null });
    const r = await processarWebhookAnchor(evt());
    expect(r).toEqual({ duplicado: false, processado: true });
    expect(m.pessoaUpdate).toHaveBeenCalledTimes(1);
  });

  it('erro de processamento: marca erro genérico e propaga (anchor reentrega)', async () => {
    m.pessoaUpdate.mockRejectedValueOnce(new Error('cpf 123.456.789-00 inválido'));
    await expect(processarWebhookAnchor(evt())).rejects.toThrow();
    expect(m.weUpdate.mock.calls[0][0].data).toEqual({ erro: 'processamento_falhou' });
  });

  it('erro de banco que não é duplicata propaga', async () => {
    m.weCreate.mockRejectedValueOnce(new Error('db down'));
    await expect(processarWebhookAnchor(evt())).rejects.toThrow('db down');
  });

  it('needsWork + userMessage: persiste o aviso point-in-time e não promove', async () => {
    await processarWebhookAnchor(
      evt({ status: 'in_progress', userMessage: 'Reenvie o verso' }, { approved: null, needsWork: true, status: 'in_progress' }),
    );
    expect(m.pessoaUpdate.mock.calls[0][0].data).toMatchObject({
      kycStatus: 'PENDENTE',
      kycAprovado: false,
      kycNeedsWork: true,
      kycUserMessage: 'Reenvie o verso',
    });
    expect(m.invUpdateMany).not.toHaveBeenCalled();
  });

  it('denied: REJEITADO e derruba kycAprovado do Investidor (fail-closed)', async () => {
    await processarWebhookAnchor(evt({ status: 'denied' }, { approved: false, status: 'denied' }));
    expect(m.pessoaUpdate.mock.calls[0][0].data).toMatchObject({ kycStatus: 'REJEITADO', kycAprovado: false });
    expect(m.invUpdateMany).toHaveBeenCalledWith({ where: { pessoaId: 'p1' }, data: { kycAprovado: false } });
  });

  it('fora de ordem: in_progress atrasado não rebaixa Pessoa já APROVADA', async () => {
    m.pessoaFind.mockResolvedValueOnce({ id: 'p1', privyId: 'x', kycStatus: 'APROVADO' });
    await processarWebhookAnchor(evt({ status: 'in_progress' }, { approved: null, status: 'in_progress' }));
    expect(m.pessoaUpdate).not.toHaveBeenCalled();
  });

  it('pessoa desconhecida: registra o evento com erro e não falha (sem reentrega infinita)', async () => {
    m.pessoaFind.mockResolvedValueOnce(null);
    const r = await processarWebhookAnchor(evt());
    expect(r.processado).toBe(true);
    expect(m.weUpdate.mock.calls[0][0].data.erro).toBe('pessoa_nao_encontrada');
  });

  it('tipo sem handler (order_updated): só registra', async () => {
    const r = await processarWebhookAnchor(evt({ tipo: 'order_updated' }));
    expect(r.processado).toBe(true);
    expect(m.pessoaFind).not.toHaveBeenCalled();
  });

  it('WebhookEvento nunca carrega userMessage', async () => {
    await processarWebhookAnchor(evt({ userMessage: 'segredo' }));
    expect(JSON.stringify(m.weCreate.mock.calls[0][0])).not.toContain('segredo');
  });
});
