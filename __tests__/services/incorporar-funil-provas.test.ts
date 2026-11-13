/** incorporarCotaDoFunil só emite com as provas (Atlas/Consuelo, 13/11): cessão ASSINADA + TransferenciaPix COMPROVADA. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  cessaoFind: vi.fn(), pixFind: vi.fn(), laudoFind: vi.fn(), incorporar: vi.fn(),
  cessaoUpdate: vi.fn(), leadUpdate: vi.fn(), auditUpdateMany: vi.fn(), notify: vi.fn(),
}));
vi.mock('@/lib/db', () => {
  const tx = {
    cessao: { update: m.cessaoUpdate },
    leadVendedor: { update: m.leadUpdate },
    eventoAudit: { updateMany: m.auditUpdateMany },
  };
  return {
    db: {
      cessao: { findUnique: m.cessaoFind },
      transferenciaPix: { findUnique: m.pixFind },
      eventoAudit: { findFirst: m.laudoFind },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/services/tokenizacao', () => ({ incorporarCota: m.incorporar }));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: m.notify }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/cessao-docusign', () => ({ enviarCessaoParaAssinatura: vi.fn() }));

import { IncorporacaoFunilBloqueadaError, incorporarCotaDoFunil } from '@/lib/services/originacao';

const cessao = (over: Record<string, unknown> = {}) => ({
  id: 'ces_1', status: 'ASSINADA', cota: null,
  pagamento: { status: 'EXECUTADO', valor: new Prisma.Decimal('400'), onChainTxHash: 'tx_pix' },
  oferta: {
    tipoBem: 'VEICULO', administradora: 'Adm', valorCarta: new Prisma.Decimal('500'),
    desagioAquisicao: new Prisma.Decimal('0.2'), prazoRestanteMeses: null, leadVendedorId: 'lead_1',
    leadVendedor: { email: 'a@exemplo.test', nome: 'Ana', status: 'PIX_EXECUTADO' },
  },
  ...over,
});
const run = () => incorporarCotaDoFunil({ cessaoId: 'ces_1', operador: 'admin-panel' });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.cessaoFind.mockResolvedValue(cessao());
  m.pixFind.mockResolvedValue({ status: 'COMPROVADA' });
  m.laudoFind.mockResolvedValue({ payloadHash: 'a'.repeat(64) });
  m.incorporar.mockResolvedValue({ cotaId: 'cota_1', txHash: 'tx_emissao', tokensEmitidos: 1 });
  m.cessaoUpdate.mockResolvedValue({});
  m.leadUpdate.mockResolvedValue({});
  m.auditUpdateMany.mockResolvedValue({ count: 1 });
  m.notify.mockResolvedValue(undefined);
});

describe('incorporarCotaDoFunil — provas antes de emitir (qualquer rede)', () => {
  it('cessão ASSINADA + Pix COMPROVADO: emite, liga o audit e NÃO re-afirma o status da cessão', async () => {
    const r = await run();
    expect(r).toMatchObject({ cotaId: 'cota_1' });
    expect(m.pixFind).toHaveBeenCalledWith({ where: { cessaoId: 'ces_1' }, select: { status: true } });
    expect(m.incorporar).toHaveBeenCalledOnce();
    expect(m.incorporar.mock.calls[0][0]).toMatchObject({ cessaoId: 'ces_1', pixHash: 'tx_pix', hashValidacao: 'a'.repeat(64) });
    expect(m.cessaoUpdate).not.toHaveBeenCalled(); // sem o "re-assert"
    expect(m.leadUpdate).toHaveBeenCalledOnce();
  });

  it.each(['PENDENTE', 'ENVIADA_DOCUSIGN', 'CANCELADA', 'EXPIRADA'])('cessão %s: recusa CESSAO_NAO_ASSINADA e NÃO emite', async (status) => {
    m.cessaoFind.mockResolvedValue(cessao({ status }));
    await expect(run()).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    expect(m.incorporar).not.toHaveBeenCalled();
    expect(m.cessaoUpdate).not.toHaveBeenCalled();
  });

  it.each(['ENVIANDO', 'PROCESSANDO', 'INCERTO', 'FALHOU'])('Pix %s: recusa PIX_NAO_COMPROVADO e NÃO emite', async (status) => {
    m.pixFind.mockResolvedValue({ status });
    await expect(run()).rejects.toMatchObject({ code: 'PIX_NAO_COMPROVADO' });
    expect(m.incorporar).not.toHaveBeenCalled();
  });

  it('Pagamento EXECUTADO do Pix LEGADO (sem TransferenciaPix) não basta: PIX_NAO_COMPROVADO', async () => {
    m.pixFind.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(IncorporacaoFunilBloqueadaError);
    expect(m.incorporar).not.toHaveBeenCalled();
  });

  it('Pagamento ausente ou não EXECUTADO: erro TIPADO PAGAMENTO_NAO_EXECUTADO (a rota devolve 409), sem emitir', async () => {
    m.cessaoFind.mockResolvedValue(cessao({ pagamento: null }));
    await expect(run()).rejects.toMatchObject({ code: 'PAGAMENTO_NAO_EXECUTADO' });
    m.cessaoFind.mockResolvedValue(cessao({ pagamento: { status: 'PENDENTE', valor: new Prisma.Decimal('1') } }));
    await expect(run()).rejects.toBeInstanceOf(IncorporacaoFunilBloqueadaError);
    expect(m.incorporar).not.toHaveBeenCalled();
  });

  const COTA = { id: 'cota_1', emissaoTxHash: 'tx_emissao', tokensEmitidos: new Prisma.Decimal('12.5') };

  it('Cota já incorporada E lead já COTA_INCORPORADA: erro tipado COTA_JA_INCORPORADA, sem emitir nem notificar', async () => {
    m.cessaoFind.mockResolvedValue(cessao({ cota: COTA, oferta: { ...cessao().oferta, leadVendedor: { email: 'a@exemplo.test', nome: 'Ana', status: 'COTA_INCORPORADA' } } }));
    await expect(run()).rejects.toMatchObject({ code: 'COTA_JA_INCORPORADA' });
    expect(m.incorporar).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('RETOMADA: a Cota existe mas o lead não foi marcado (queda no meio): NÃO emite de novo e completa o vínculo e o e-mail', async () => {
    m.cessaoFind.mockResolvedValue(cessao({ cota: COTA }));
    const r = await run();
    expect(r).toEqual({ cotaId: 'cota_1', txHash: 'tx_emissao', tokensEmitidos: 12.5 });
    expect(m.incorporar).not.toHaveBeenCalled();
    expect(m.leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead_1' }, data: { status: 'COTA_INCORPORADA' } });
    expect(m.auditUpdateMany).toHaveBeenCalledWith({
      where: { cotaId: 'cota_1', acao: 'COTA_INCORPORADA' },
      data: { leadVendedorId: 'lead_1', cessaoId: 'ces_1' },
    });
    expect(m.notify).toHaveBeenCalledOnce();
  });

  it('a retomada também exige as provas (cessão ASSINADA e Pix COMPROVADO)', async () => {
    m.cessaoFind.mockResolvedValue(cessao({ cota: COTA, status: 'PENDENTE' }));
    await expect(run()).rejects.toMatchObject({ code: 'CESSAO_NAO_ASSINADA' });
    m.cessaoFind.mockResolvedValue(cessao({ cota: COTA }));
    m.pixFind.mockResolvedValue({ status: 'FALHOU' });
    await expect(run()).rejects.toMatchObject({ code: 'PIX_NAO_COMPROVADO' });
    expect(m.leadUpdate).not.toHaveBeenCalled();
  });

  it('a mensagem do erro é fixa, sem dado do cedente', async () => {
    m.pixFind.mockResolvedValue({ status: 'FALHOU' });
    const e = await run().catch((x) => x);
    expect(String(e.message)).not.toMatch(/Ana|exemplo|ces_1/);
  });
});
