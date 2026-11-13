import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Account, Asset, Memo, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { NavMudouError } from '@/lib/services/emissao';
import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { networkPassphrase } from '@/lib/stellar/config';
import { TrustlineNaoAutorizadaError } from '@/lib/stellar/trustline';

const USER = Keypair.random();
const USER_PK = USER.publicKey();
const OTHER_PK = Keypair.random().publicKey();
const DIST_PK = Keypair.random().publicKey();
const ISSUER = Keypair.random();

const {
  quoteFindUnique,
  quoteUpdateMany,
  quoteFindFirst,
  investidorUpdate,
  eventoAuditCreate,
  movimentoCreateMany,
  holdingUpsert,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
  assertElegivelParaTrustline,
  assertSwapXdrMatchesQuote,
  resolveTesouroAsset,
  preSignWithSigner,
  revalidarNav,
  exigirTrustline,
} = vi.hoisted(() => ({
  quoteFindUnique: vi.fn(),
  quoteUpdateMany: vi.fn(),
  quoteFindFirst: vi.fn(),
  investidorUpdate: vi.fn(),
  eventoAuditCreate: vi.fn(),
  movimentoCreateMany: vi.fn(),
  holdingUpsert: vi.fn(),
  submitWithPrivySignature: vi.fn(),
  txHashFromXdr: vi.fn(),
  fetchTransactionByHash: vi.fn(),
  assertElegivelParaTrustline: vi.fn(),
  assertSwapXdrMatchesQuote: vi.fn(),
  resolveTesouroAsset: vi.fn(),
  preSignWithSigner: vi.fn(),
  revalidarNav: vi.fn(),
  exigirTrustline: vi.fn(),
}));

vi.mock('@/lib/wallet/auth-guard', () => ({
  withAuth: (
    handler: (
      req: Request,
      ctx: { user: Record<string, unknown> },
    ) => Promise<Response>,
  ) =>
    (req: Request) =>
      handler(req, {
        user: {
          privyId: 'did:privy:abc',
          investidorId: 'inv_1',
          publicKey: USER_PK,
          email: 'x@y.z',
          etherfuseCustomerId: 'cust_1',
        },
      }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: quoteFindUnique, updateMany: quoteUpdateMany, findFirst: quoteFindFirst },
    resgateCotacao: { findFirst: async () => null },
    $transaction: async (
      cb: (tx: {
        quote: { updateMany: typeof quoteUpdateMany };
        investidor: { update: typeof investidorUpdate };
        eventoAudit: { create: typeof eventoAuditCreate };
        movimentoFundo: { createMany: typeof movimentoCreateMany };
        holdingPLINARF: { upsert: typeof holdingUpsert };
      }) => Promise<unknown>,
    ) =>
      cb({
        quote: { updateMany: quoteUpdateMany },
        investidor: { update: investidorUpdate },
        eventoAudit: { create: eventoAuditCreate },
        movimentoFundo: { createMany: movimentoCreateMany },
        holdingPLINARF: { upsert: holdingUpsert },
      }),
  },
}));

// A rota usa txHashFromXdr + fetchTransactionByHash no submit-or-reconcile.
// Mock explícito (nada de importActual) pra manter o teste hermético: o real
// `fetchTransactionByHash` bate no Horizon.
vi.mock('@/lib/stellar/transactions', () => ({
  preSignWithSigner,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
}));
vi.mock('@/lib/stellar/trustline', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/trustline')>()),
  exigirEmissoesParaTrustlineAutorizada: exigirTrustline,
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({ id: 'issuer' }) }));
vi.mock('@/lib/stellar/fee', () => ({ getDynamicFee: vi.fn().mockResolvedValue('100') }));
vi.mock('@/lib/services/emissao', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/emissao')>();
  return { ...actual, revalidarNavDaCotacao: revalidarNav };
});
vi.mock('@/lib/services/investidor', () => ({ assertElegivelParaTrustline }));
vi.mock('@/lib/stellar/parse-swap-xdr', () => ({ assertSwapXdrMatchesQuote }));
vi.mock('@/lib/anchors/etherfuse/tesouro', () => ({ resolveTesouroAsset }));

// N1: as chaves públicas vêm só do env; o ISSUER assina no submit (depois de validar).
process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;

import { POST } from '@/app/api/investidor/buy/swap/submit/route';
import { ApiError } from '@/lib/api/errors';

function req(body: object): Request {
  return new Request('http://x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** XDR real assinado pelo investidor (a rota confere a assinatura dele antes de assinar pela Plina). */
function realTx(amount = '1') {
  return new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount }))
    .setTimeout(0)
    .build();
}
const TX = realTx();
TX.sign(USER);
const ISSUER_SIG = 'issuer-sig-base64';

const FULL_BODY = {
  quoteId: 'q_1',
  signedXdr: TX.toXDR(),
};

/** sha256(hash da tx) — é o que a rota usa como chave de reserva (C-04). */
const XDR_HASH = createHash('sha256').update(TX.hash()).digest('hex');

function baseQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q_1',
    investidorId: 'inv_1',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    fromAmount: new Prisma.Decimal('100'),
    toAmount: new Prisma.Decimal('99.5'),
    navPorTokenNaCotacao: new Prisma.Decimal('1'),
    plinarfAmount: new Prisma.Decimal('99.5'),
    investidor: { publicKey: 'GABC' },
    onRampOrder: {
      id: 'ord_1',
      status: 'completed',
      paymentInstructionsJson: {},
    },
    ...overrides,
  };
}

beforeEach(() => {
  quoteFindUnique.mockReset();
  quoteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  quoteFindFirst.mockReset().mockResolvedValue(null); // sem outro swap em conferência
  investidorUpdate.mockReset().mockResolvedValue({});
  eventoAuditCreate.mockReset().mockResolvedValue({});
  movimentoCreateMany.mockReset().mockResolvedValue({ count: 1 });
  holdingUpsert.mockReset().mockResolvedValue({});
  submitWithPrivySignature
    .mockReset()
    .mockResolvedValue({ hash: 'tx_real_hash' });
  txHashFromXdr.mockReset().mockReturnValue('tx_real_hash');
  preSignWithSigner.mockReset().mockReturnValue({ pubkey: ISSUER.publicKey(), sigBase64: ISSUER_SIG });
  revalidarNav.mockReset().mockResolvedValue(undefined);
  exigirTrustline.mockReset().mockResolvedValue(undefined);
  fetchTransactionByHash.mockReset().mockResolvedValue(null);
  assertElegivelParaTrustline.mockReset().mockResolvedValue(undefined);
  assertSwapXdrMatchesQuote.mockReset();
  resolveTesouroAsset
    .mockReset()
    .mockResolvedValue({
      code: 'TESOURO',
      issuer: 'GTESOURO',
      identifier: 'TESOURO:GTESOURO',
    });
  process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST_PK;
});

describe('POST /api/investidor/buy/swap/submit', () => {
  it('400 faltando campos', async () => {
    const r = await POST(req({ quoteId: 'q_1' }));
    expect(r.status).toBe(400);
  });

  it('400 quando o XDR não está assinado pelo investidor da sessão (assinatura de outra chave)', async () => {
    const outro = realTx();
    outro.sign(Keypair.random());
    const r = await POST(req({ ...FULL_BODY, signedXdr: outro.toXDR() }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/assinatura do investidor/);
    expect(quoteFindUnique).not.toHaveBeenCalled();
    expect(preSignWithSigner).not.toHaveBeenCalled();
  });

  it('404 quote inexistente', async () => {
    quoteFindUnique.mockResolvedValueOnce(null);
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(404);
  });

  it('403 quote de outro investidor', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ investidorId: 'inv_OUTRO' }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(403);
  });

  it('409 quando onramp não está completed', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        onRampOrder: { id: 'ord_1', status: 'pending', paymentInstructionsJson: {} },
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
  });

  it('C-04: retry após sucesso com mesmo XDR → 200 idempotente sem re-submit', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: XDR_HASH,
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_prev');
    expect(json.idempotent).toBe(true);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-04: quote consumido com XDR diferente → 409', async () => {
    quoteFindUnique.mockResolvedValueOnce(
      baseQuote({
        consumedAt: new Date(),
        consumedTxHash: 'tx_prev',
        submitXdrHash: 'hash_de_outra_xdr',
      }),
    );
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('C-01: 400 quando XDR diverge do quote (amount inflado)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    assertSwapXdrMatchesQuote.mockImplementationOnce(() => {
      throw new Error('leg2 amount=999.0000000 ≠ esperado=99.5000000');
    });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toMatch(/xdr divergente/);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('reserva órfã + tx já on-chain → reconcilia sem re-submeter', async () => {
    quoteFindUnique
      // 1ª leitura: quote ainda não consumido, mas já reservado por esta XDR.
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH }))
      // 2ª leitura (`fresh`, após a reserva falhar): mesma XDR, sem consumedAt.
      .mockResolvedValueOnce({
        submitXdrHash: XDR_HASH,
        consumedTxHash: null,
        consumedAt: null,
      });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 }); // reserva já existe
    fetchTransactionByHash.mockResolvedValueOnce({
      hash: 'tx_ja_onchain',
      successful: true,
    });

    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect((await r.json()).swapTxHash).toBe('tx_ja_onchain');
    // O ponto do reconcile: os tokens já foram mintados, só falta escriturar.
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
  });

  it('reserva órfã + tx falhou on-chain → 409 (pede rebuild)', async () => {
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH }))
      .mockResolvedValueOnce({
        submitXdrHash: XDR_HASH,
        consumedTxHash: null,
        consumedAt: null,
      });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
    fetchTransactionByHash.mockResolvedValueOnce({
      hash: 'tx_falha',
      successful: false,
    });

    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('200 happy path consome quote + incrementa saldo + audit', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.swapTxHash).toBe('tx_real_hash');
    expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    // C-04: updateMany chamado 2x — reserve (submitXdrHash:null) + consume.
    expect(quoteUpdateMany).toHaveBeenCalledTimes(2);
    expect(quoteUpdateMany.mock.calls[0][0].where.submitXdrHash).toBeNull();
    expect(quoteUpdateMany.mock.calls[1][0].where.consumedAt).toBeNull();
    expect(investidorUpdate).toHaveBeenCalledOnce();
    expect(investidorUpdate.mock.calls[0][0].where.id).toBe('inv_1');
    expect(eventoAuditCreate).toHaveBeenCalledOnce();
    expect(eventoAuditCreate.mock.calls[0][0].data.acao).toBe('SWAP_EXECUTADO');
    expect(eventoAuditCreate.mock.calls[0][0].data.payloadJson.mock).toBe(false);
    expect(eventoAuditCreate.mock.calls[0][0].data.privyId).toBe('did:privy:abc');
  });

  it('N1: o caixa do fundo recebe o valor LÍQUIDO do fee (fee ≠ 0), o mesmo V que gerou q', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ fromAmount: new Prisma.Decimal('150'), fee: '50' }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    const mov = movimentoCreateMany.mock.calls[0][0].data[0];
    expect(mov.tipo).toBe('SUBSCRICAO');
    expect(new Prisma.Decimal(mov.valorBrl).toFixed(2)).toBe('100.00'); // 150 − 50, não 150
  });

  it('N1: cotação antiga de classe SUBORDINADA é recusada (422 CLASSE_INDISPONIVEL), sem reservar nem assinar', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ classe: 'SUBORDINADA' }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe('CLASSE_INDISPONIVEL');
    expect(quoteUpdateMany).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: a Plina assina só no submit: o issuer do env co-assina e vai em extraSignatures com a chave do env', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req(FULL_BODY));
    expect(preSignWithSigner).toHaveBeenCalledTimes(1);
    const arg = submitWithPrivySignature.mock.calls[0][0];
    expect(arg.extraSignatures).toEqual([{ pubkey: ISSUER.publicKey(), sigBase64: ISSUER_SIG }]);
    // o envelope é reenviado SEM assinaturas; a do investidor entra por investorSignatureHex
    expect(new Transaction(arg.xdr, networkPassphrase).signatures).toHaveLength(0);
    expect(arg.investorPubkey).toBe(USER_PK);
    expect(arg.investorSignatureHex).toBe('0x' + Buffer.from(TX.signatures[0].signature()).toString('hex'));
  });

  it('N1: a Plina NÃO assina quando o XDR diverge do quote (4xx, sem assinar, sem gastar fee)', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    assertSwapXdrMatchesQuote.mockImplementationOnce(() => { throw new Error('leg2 source ≠ issuer'); });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(400);
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(quoteUpdateMany).not.toHaveBeenCalled();
  });

  it('N1: o validador recebe issuer, distributor e investidor do ENV/sessão, nunca do body', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req(FULL_BODY));
    const expected = assertSwapXdrMatchesQuote.mock.calls[0][1];
    expect(expected.issuerPubkey).toBe(ISSUER.publicKey());
    expect(expected.distributorPubkey).toBe(DIST_PK);
    expect(expected.investorPubkey).toBe(USER_PK);
  });

  it('N1: body com campos do desenho antigo (investorPubkey, signatureHex, xdr, issuerSigBase64, distributorPubkey…) → 400, nada acontece', async () => {
    for (const extra of [
      { investorPubkey: USER_PK },
      { signatureHex: 'a'.repeat(128) },
      { issuerSigBase64: 'sig' },
      { distributorPubkey: Keypair.random().publicKey() },
      { distributorSigBase64: 'sig==' },
      { investidorId: 'inv_1' },
    ]) {
      const r = await POST(req({ ...FULL_BODY, ...extra }));
      expect(r.status).toBe(400);
    }
    expect(quoteFindUnique).not.toHaveBeenCalled();
    expect(preSignWithSigner).not.toHaveBeenCalled();
  });

  it('N1: envelope com mais de uma assinatura ou sem a do investidor → 400, sem assinar', async () => {
    quoteFindUnique.mockResolvedValue(baseQuote());
    const duas = realTx(); duas.sign(USER); duas.sign(Keypair.random());
    expect((await POST(req({ ...FULL_BODY, signedXdr: duas.toXDR() }))).status).toBe(400);
    const nenhuma = realTx();
    expect((await POST(req({ ...FULL_BODY, signedXdr: nenhuma.toXDR() }))).status).toBe(400);
    expect((await POST(req({ ...FULL_BODY, signedXdr: 'nao-e-xdr' }))).status).toBe(400);
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: signer do issuer que não é o issuer do env → erro, nada submetido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    preSignWithSigner.mockReturnValueOnce({ pubkey: Keypair.random().publicKey(), sigBase64: 'x' });
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: sem as chaves no env → 500 e nada acontece', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    delete process.env.STELLAR_DISTRIBUTOR_PUBLIC;
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(500);
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('L1-S2: NAV mudou além de 1 bp → 409 NAV_MUDOU, sem assinar nem reservar', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    revalidarNav.mockRejectedValueOnce(new NavMudouError());
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'O NAV mudou; gere uma nova cotação.', code: 'NAV_MUDOU' });
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(quoteUpdateMany).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('L1-S2: o submit relê o NAV com o BRL e o NAV congelados do quote', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    await POST(req(FULL_BODY));
    expect(revalidarNav.mock.calls[0][0].fromAmount.toFixed(2)).toBe('100.00');
    expect(revalidarNav.mock.calls[0][0].navPorTokenNaCotacao.toFixed(2)).toBe('1.00');
  });

  it('L1-S2: sem NAV (ledger fora / PLINARFB) → 503 constante, sem assinar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    revalidarNav.mockRejectedValueOnce(new NavIndisponivelError('SUBORDINADA_CIRCULANDO'));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe('LEDGER_UNAVAILABLE');
    expect(preSignWithSigner).not.toHaveBeenCalled();
  });

  it('L1-S2: o quote expira mesmo com o onramp completed (410), sem ler NAV nem assinar', async () => {
    quoteFindUnique.mockResolvedValueOnce(baseQuote({ expiresAt: new Date(Date.now() - 1_000) }));
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(410);
    expect(revalidarNav).not.toHaveBeenCalled();
    expect(preSignWithSigner).not.toHaveBeenCalled();
  });

  it('L1-S2: reserva órfã (mesma XDR já em curso) NÃO revalida o NAV nem expira — a tx pode já estar no ledger', async () => {
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH, expiresAt: new Date(Date.now() - 1_000) }))
      .mockResolvedValueOnce({ submitXdrHash: XDR_HASH, consumedTxHash: null, consumedAt: null });
    quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
    fetchTransactionByHash.mockResolvedValueOnce({ hash: 'tx_ja_onchain', successful: true });
    txHashFromXdr.mockReturnValue('tx_ja_onchain');
    const r = await POST(req(FULL_BODY));
    expect(r.status).toBe(200);
    expect(revalidarNav).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
  });

  it('N1: a reserva grava o hash da tx e o maxTime do envelope (para reconciliar sem o investidor)', async () => {
    const maxSec = Math.floor(Date.now() / 1000) + 100;
    const tx = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
      .setTimebounds(0, maxSec)
      .build();
    tx.sign(USER);
    txHashFromXdr.mockReturnValueOnce('tx_hash_do_envelope');
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    const r = await POST(req({ quoteId: 'q_1', signedXdr: tx.toXDR() }));
    expect(r.status).toBe(200);
    const reserva = quoteUpdateMany.mock.calls[0][0];
    expect(reserva.where.submitXdrHash).toBeNull();
    expect(reserva.data.submitTxHash).toBe('tx_hash_do_envelope');
    expect(reserva.data.submitMaxTime).toEqual(new Date(maxSec * 1000));
  });

  // N1-S1 (Argus): reserva órfã só pode ser re-assinada enquanto o envelope vale.
  describe('reserva órfã × prazo do envelope (N1-S1: re-assina só antes do maxTime; nunca libera por "não achei")', () => {
    const txComPrazo = (maxTimeSec: number | 'sem') => {
      const b = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
        .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }));
      const tx = maxTimeSec === 'sem' ? b.setTimeout(0).build() : b.setTimebounds(0, maxTimeSec).build();
      tx.sign(USER);
      return { xdr: tx.toXDR(), hash: createHash('sha256').update(tx.hash()).digest('hex') };
    };
    const agoraSec = () => Math.floor(Date.now() / 1000);

    async function orfa(maxTimeSec: number | 'sem') {
      const { xdr, hash } = txComPrazo(maxTimeSec);
      quoteFindUnique
        .mockResolvedValueOnce(baseQuote({ submitXdrHash: hash }))
        .mockResolvedValueOnce({ submitXdrHash: hash, consumedTxHash: null, consumedAt: null });
      quoteUpdateMany.mockResolvedValueOnce({ count: 0 }); // a reserva já existe: órfã
      fetchTransactionByHash.mockResolvedValueOnce(null); // a tx NÃO está na chain (404)
      const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
      return { r, hash };
    }

    it('antes do maxTime: re-assina e reenvia o mesmo envelope', async () => {
      const { r } = await orfa(agoraSec() + 100);
      expect(r.status).toBe(200);
      expect(submitWithPrivySignature).toHaveBeenCalledOnce();
    });

    it('depois do maxTime e 404: 410, NUNCA assina e NÃO libera a reserva (sem prova de não-entrada)', async () => {
      const { r } = await orfa(agoraSec() - 600);
      expect(r.status).toBe(410);
      expect((await r.json()).code).toBe('GONE');
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(quoteUpdateMany).toHaveBeenCalledTimes(1); // só a tentativa de reserva: NADA liberado
    });

    it('logo depois do maxTime (mesmo dentro da folga do ledger) também não assina e não libera', async () => {
      const { r } = await orfa(agoraSec() - 10);
      expect(r.status).toBe(410);
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(quoteUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('envelope SEM maxTime em reserva órfã: nunca re-assina (410, sem liberar)', async () => {
      const { r } = await orfa('sem');
      expect(r.status).toBe(410);
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(quoteUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('órfã + a tx falhou on-chain (prova positiva): 409 e LIBERA a reserva', async () => {
      const { xdr, hash } = txComPrazo(agoraSec() + 100);
      quoteFindUnique
        .mockResolvedValueOnce(baseQuote({ submitXdrHash: hash }))
        .mockResolvedValueOnce({ submitXdrHash: hash, consumedTxHash: null, consumedAt: null });
      quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
      fetchTransactionByHash.mockResolvedValueOnce({ hash: 'tx_falhou', successful: false });
      const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
      expect(r.status).toBe(409);
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(quoteUpdateMany.mock.calls[1][0].data).toEqual({ submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null, livreExpiradaVistaEm: null });
    });
  });

  describe('N1-at: trustline revogada entre o build e o submit (Vera F-N1AT-1)', () => {
    const LIBERA = { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null, livreExpiradaVistaEm: null };
    const agoraSec = () => Math.floor(Date.now() / 1000);
    const txComPrazo = (maxTimeSec: number) => {
      const tx = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
        .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
        .setTimebounds(0, maxTimeSec)
        .build();
      tx.sign(USER);
      return { xdr: tx.toXDR(), hash: createHash('sha256').update(tx.hash()).digest('hex') };
    };
    const liberou = () => quoteUpdateMany.mock.calls.some((c) => JSON.stringify(c[0].data) === JSON.stringify(LIBERA));

    it.each(['TRUSTLINE_NAO_AUTORIZADA', 'TRUSTLINE_AUSENTE'] as const)(
      '1º envio, guarda recusa (%s): 409 com o código, NADA vai à rede e a reserva é LIBERADA (o NAV não fecha)',
      async (code) => {
        quoteFindUnique.mockResolvedValueOnce(baseQuote());
        exigirTrustline.mockRejectedValue(new TrustlineNaoAutorizadaError(code, USER_PK, `PLINARF:${ISSUER.publicKey()}`));
        const r = await POST(req(FULL_BODY));
        expect(r.status).toBe(409);
        expect(await r.json()).toMatchObject({ code });
        expect(submitWithPrivySignature).not.toHaveBeenCalled();
        expect(liberou()).toBe(true);
        expect(eventoAuditCreate).not.toHaveBeenCalled();
      },
    );

    it('1º envio, a leitura da conta (Horizon) falha: nada foi enviado → libera a reserva e o erro propaga como antes (500)', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      exigirTrustline.mockRejectedValue(new Error('horizon fora'));
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(500);
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(liberou()).toBe(true);
    });

    it('a guarda DENTRO do submitWithPrivySignature recusa (revogada entre a checagem e o envio): 409 e libera', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      submitWithPrivySignature.mockRejectedValue(new TrustlineNaoAutorizadaError('TRUSTLINE_NAO_AUTORIZADA', USER_PK, 'x'));
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe('TRUSTLINE_NAO_AUTORIZADA');
      expect(liberou()).toBe(true);
    });

    it('erro do envio à rede (não da guarda): NÃO libera (a tx pode ter entrado) — comportamento anterior', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      submitWithPrivySignature.mockRejectedValue(new Error('timeout'));
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(500);
      expect(liberou()).toBe(false);
    });

    it('REENVIO de órfã com a guarda recusando: 409, mas a reserva FICA (a tx pode já ter entrado; o varredor decide)', async () => {
      const { xdr, hash } = txComPrazo(agoraSec() + 100);
      quoteFindUnique
        .mockResolvedValueOnce(baseQuote({ submitXdrHash: hash }))
        .mockResolvedValueOnce({ submitXdrHash: hash, consumedTxHash: null, consumedAt: null });
      quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
      fetchTransactionByHash.mockResolvedValueOnce(null); // a tx NÃO está na chain (404)
      exigirTrustline.mockRejectedValue(new TrustlineNaoAutorizadaError('TRUSTLINE_NAO_AUTORIZADA', USER_PK, 'x'));
      const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
      expect(r.status).toBe(409);
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
      expect(liberou()).toBe(false);
    });

    it('com a trustline autorizada nada muda: confere a guarda ANTES do envio e envia', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(200);
      expect(exigirTrustline.mock.invocationCallOrder[0]).toBeLessThan(submitWithPrivySignature.mock.invocationCallOrder[0]);
    });
  });

  describe('swap em conferência do mesmo investidor (mitigação de disponibilidade)', () => {
    it('reserva NOVA com outro swap órfão do mesmo investidor → 409 SWAP_EM_CONFERENCIA, sem reservar nem assinar', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      quoteFindFirst.mockResolvedValueOnce({ id: 'q_outro' });
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe('SWAP_EM_CONFERENCIA');
      expect(quoteFindFirst.mock.calls[0][0].where).toMatchObject({ investidorId: 'inv_1', id: { not: 'q_1' }, consumedAt: null });
      expect(quoteUpdateMany).not.toHaveBeenCalled();
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
    });

    it('o retry da PRÓPRIA reserva (quote já reservado por esta XDR) não é bloqueado', async () => {
      quoteFindUnique
        .mockResolvedValueOnce(baseQuote({ submitXdrHash: XDR_HASH }))
        .mockResolvedValueOnce({ submitXdrHash: XDR_HASH, consumedTxHash: null, consumedAt: null });
      quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
      fetchTransactionByHash.mockResolvedValueOnce({ hash: 'tx_ja_onchain', successful: true });
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(200);
      expect(quoteFindFirst).not.toHaveBeenCalled();
    });

    it('a reserva grava o XDR do envelope (para a prova pela conta do investidor)', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r = await POST(req(FULL_BODY));
      expect(r.status).toBe(200);
      expect(quoteUpdateMany.mock.calls[0][0].data.submitXdr).toBe(FULL_BODY.signedXdr);
    });
  });

  describe('memo e fee do envelope (N1-S1 c)', () => {
    const txCom = (opts: { fee?: string; memo?: string }) => {
      const b = new TransactionBuilder(new Account(USER_PK, '1'), { fee: opts.fee ?? '100', networkPassphrase })
        .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
        .setTimeout(120);
      if (opts.memo) b.addMemo(Memo.text(opts.memo));
      const tx = b.build();
      tx.sign(USER);
      return tx.toXDR();
    };

    it('fee abaixo do mínimo da rede → 400, sem reservar nem assinar', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r = await POST(req({ quoteId: 'q_1', signedXdr: txCom({ fee: '50' }) })); // 1 op × 50 < 100
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/fee/);
      expect(quoteUpdateMany).not.toHaveBeenCalled();
      expect(submitWithPrivySignature).not.toHaveBeenCalled();
    });

    it('o validador recebe o prazo do quote e o memo do build (memo/prazo são conferidos lá)', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r = await POST(req({ quoteId: 'q_1', signedXdr: txCom({ memo: 'q:q_1' }) }));
      expect(r.status).toBe(200);
      const expectativa = assertSwapXdrMatchesQuote.mock.calls[0][1];
      expect(expectativa.memoTexto).toBe('q:q_1');
      expect(expectativa.quoteExpiresAt).toBeInstanceOf(Date);
    });

    it('fee igual ou acima do mínimo passa', async () => {
      quoteFindUnique.mockResolvedValueOnce(baseQuote());
      const r = await POST(req({ quoteId: 'q_1', signedXdr: txCom({ fee: '100' }) }));
      expect(r.status).toBe(200);
    });
  });
});


// ── QA do N1 (Vera): falha do Horizon, retry, investidor inelegível e erro interno ──
describe('POST /api/investidor/buy/swap/submit — falhas e inelegibilidade (QA N1)', () => {
  const agoraSec = () => Math.floor(Date.now() / 1000);
  function txJanela(maxTimeSec: number) {
    const t = new TransactionBuilder(new Account(USER_PK, '1'), { fee: '100', networkPassphrase })
      .addOperation(Operation.payment({ source: USER_PK, destination: DIST_PK, asset: Asset.native(), amount: '1' }))
      .setTimebounds(0, maxTimeSec)
      .build();
    t.sign(USER);
    return { xdr: t.toXDR(), hash: createHash('sha256').update(t.hash()).digest('hex') };
  }
  const erroHorizon = (codes: unknown) =>
    Object.assign(new Error('Request failed with status code 400'), {
      response: {
        data: {
          status: 400,
          title: 'Transaction Failed',
          extras: { result_codes: codes, envelope_xdr: 'ENVELOPE_COM_A_ASSINATURA_DO_ISSUER' },
        },
      },
    });

  it('falha do submit (op_no_trust): 500 com os result_codes, SEM vazar o envelope co-assinado, quote NÃO consumido', async () => {
    const { xdr } = txJanela(agoraSec() + 100);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(erroHorizon({ transaction: 'tx_failed', operations: ['op_no_trust'] }));
    const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
    expect(r.status).toBe(500);
    const texto = await r.text();
    expect(texto).toContain('op_no_trust');
    expect(texto).not.toContain('ENVELOPE_COM_A_ASSINATURA_DO_ISSUER');
    expect(texto).not.toContain(ISSUER_SIG);
    expect(investidorUpdate).not.toHaveBeenCalled();
    expect(eventoAuditCreate).not.toHaveBeenCalled();
    expect(movimentoCreateMany).not.toHaveBeenCalled();
  });

  it('falha ambígua do submit e retry com a MESMA XDR (ainda no prazo): consulta a chain e escritura UMA vez', async () => {
    const { xdr, hash } = txJanela(agoraSec() + 100);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    submitWithPrivySignature.mockRejectedValueOnce(new Error('timeout'));
    expect((await POST(req({ quoteId: 'q_1', signedXdr: xdr }))).status).toBe(500);

    quoteUpdateMany.mockResolvedValueOnce({ count: 0 });
    quoteFindUnique
      .mockResolvedValueOnce(baseQuote({ submitXdrHash: hash }))
      .mockResolvedValueOnce({ submitXdrHash: hash, consumedTxHash: null, consumedAt: null });
    fetchTransactionByHash.mockResolvedValueOnce(null);
    const r2 = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
    expect(r2.status).toBe(200);
    expect(fetchTransactionByHash).toHaveBeenCalled();
    expect(submitWithPrivySignature).toHaveBeenCalledTimes(2);
    expect(investidorUpdate).toHaveBeenCalledTimes(1);
    expect(movimentoCreateMany).toHaveBeenCalledTimes(1);
  });

  it('investidor inelegível (KYC pendente): ApiError 403 com a mensagem de negócio; a Plina não assina nem reserva', async () => {
    const { xdr } = txJanela(agoraSec() + 100);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    assertElegivelParaTrustline.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403, 'KYC pendente — trustline negada (whitepaper §6.5).'));
    const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
    expect(r.status).toBe(403);
    const corpo = await r.json();
    expect(corpo.code).toBe('FORBIDDEN');
    expect(corpo.error).toContain('KYC pendente');
    expect(preSignWithSigner).not.toHaveBeenCalled();
    expect(submitWithPrivySignature).not.toHaveBeenCalled();
    expect(quoteUpdateMany).not.toHaveBeenCalled();
  });

  it('erro interno (banco/config) NÃO devolve a mensagem crua ao cliente (L1-S5)', async () => {
    const { xdr } = txJanela(agoraSec() + 100);
    quoteFindUnique.mockResolvedValueOnce(baseQuote());
    quoteUpdateMany.mockRejectedValueOnce(
      new Error("Invalid `prisma.quote.updateMany()` invocation in /srv/app/route.ts:229 Can't reach database server at postgresql://plina:SEGREDO@db.interno:5432/plina"),
    );
    const r = await POST(req({ quoteId: 'q_1', signedXdr: xdr }));
    const texto = await r.text();
    expect(r.status).toBe(500);
    expect(texto).not.toContain('SEGREDO');
    expect(texto).not.toContain('/srv/app');
  });
});
