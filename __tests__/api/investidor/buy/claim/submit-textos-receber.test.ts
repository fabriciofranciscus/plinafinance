/**
 * Glossário "receber" (Norma, mural 3536; Flora): as 3 mensagens FIXAS de erro do claim/submit dizem "recebimento"/"receber", nunca
 * "resgate"/"resgatar" (resgate é o verbo da SAÍDA do investidor). Os `code` e os status não mudam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';

const INV = Keypair.random().publicKey();
const OUTRO = Keypair.random().publicKey();
const BAL = '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368';

const m = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), audit: vi.fn(), submit: vi.fn(), fetchTx: vi.fn(), ativoDoCb: vi.fn(), claimConfirmado: vi.fn() }));
vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (h: (req: Request, ctx: { user: Record<string, unknown> }) => Promise<Response>) => (req: Request) =>
    h(req, { user: { privyId: 'did:privy:abc', investidorId: 'inv_1', publicKey: INV } }),
}));
vi.mock('@/lib/db', () => ({
  db: { onRampOrder: { findUnique: m.findUnique, update: m.update }, eventoAudit: { create: m.audit }, $transaction: vi.fn() },
}));
vi.mock('@/lib/stellar/transactions', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/transactions')>()),
  submitWithPrivySignature: m.submit,
  fetchTransactionByHash: m.fetchTx,
}));
vi.mock('@/lib/stellar/claim', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/claim')>()),
  ativoDoClaimableBalance: m.ativoDoCb,
  claimConfirmadoNaTx: m.claimConfirmado,
}));

import { POST } from '@/app/api/investidor/buy/claim/submit/route';

const envelope = (source = INV) =>
  new TransactionBuilder(new Account(source, '100'), { fee: '100', networkPassphrase })
    .addOperation(Operation.claimClaimableBalance({ balanceId: BAL }))
    .setTimeout(120)
    .build()
    .toXDR();
const post = (xdr: string) =>
  POST(new Request('http://x/claim/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: 'order-x', xdr, signatureHex: '0xsig' }) }));
const ORDEM = { id: 'order-x', investidorId: 'inv_1', claimTxHash: null, stellarClaimableBalanceId: BAL };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const f of Object.values(m)) f.mockReset();
  m.findUnique.mockResolvedValue({ ...ORDEM });
  m.fetchTx.mockResolvedValue(null);
});

describe('claim/submit — textos do glossário "receber"', () => {
  it('XDR que não é o recebimento da ordem → 409 XDR_NAO_CONFERE com o texto novo', async () => {
    const r = await post(envelope(OUTRO)); // source de outra conta
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toEqual({ error: 'A transação enviada não é o recebimento desta compra. Nada foi registrado.', code: 'XDR_NAO_CONFERE' });
    expect(j.error).not.toMatch(/resgat/i);
  });

  it('ordem sem saldo a receber → 409 CB_AUSENTE com o texto novo', async () => {
    m.findUnique.mockResolvedValue({ ...ORDEM, stellarClaimableBalanceId: null });
    const r = await post(envelope());
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toEqual({ error: 'A compra ainda não tem saldo a receber.', code: 'CB_AUSENTE' });
    expect(j.error).not.toMatch(/resgat/i);
  });

  it('saldo já não está no ledger → 409 CB_NOT_FOUND com o texto novo', async () => {
    m.ativoDoCb.mockResolvedValue(null);
    const r = await post(envelope());
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toEqual({ error: 'O saldo a receber não está mais disponível.', code: 'CB_NOT_FOUND' });
    expect(j.error).not.toMatch(/resgat/i);
    expect(m.submit).not.toHaveBeenCalled();
  });
});
