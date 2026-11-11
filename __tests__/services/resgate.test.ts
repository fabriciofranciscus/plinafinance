import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { Account, Asset, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import { networkPassphrase } from '@/lib/stellar/config';

const ISSUER = Keypair.random();
const DIST = Keypair.random();
const INV = Keypair.random();
const TESOURO = new Asset('TESOURO', Keypair.random().publicKey());
const AGORA = 1_800_000_000_000; // ms
const AGORA_SEC = AGORA / 1000;

const m = vi.hoisted(() => ({
  create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(),
  preco: vi.fn(), buildResgate: vi.fn(), fetchTx: vi.fn(), preSign: vi.fn(), submitPrivy: vi.fn(),
  conferencia: vi.fn(), decrementar: vi.fn(), investidorUpdate: vi.fn(), eventoCreate: vi.fn(), movCreateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    resgateCotacao: { updateMany: m.updateMany },
    investidor: { update: m.investidorUpdate },
    eventoAudit: { create: m.eventoCreate },
    movimentoFundo: { createMany: m.movCreateMany },
  };
  return {
    db: {
      resgateCotacao: { create: m.create, findFirst: m.findFirst, findUnique: m.findUnique, updateMany: m.updateMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock('@/lib/services/liquidacao', () => ({ calcularPrecoDeResgate: m.preco }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: m.decrementar }));
vi.mock('@/lib/services/swap-orfao', () => ({ assertSemSwapEmConferencia: m.conferencia }));
vi.mock('@/lib/stellar/signer', () => ({ distributorSigner: () => ({ id: 'dist' }) }));
vi.mock('@/lib/stellar/transactions', () => ({
  fetchTransactionByHash: m.fetchTx,
  preSignWithSigner: m.preSign,
  submitWithPrivySignature: m.submitPrivy,
}));
vi.mock('@/lib/stellar/resgate', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/resgate')>()),
  buildResgateXdr: m.buildResgate, // o builder real precisa do Horizon; o validador fica REAL
}));

import { ApiError } from '@/lib/api/errors';
import { NavIndisponivelError } from '@/lib/services/nav-supply';
import { cotarResgate, submeterResgate } from '@/lib/services/resgate';
import { memoHashDoResgate } from '@/lib/services/regras-resgate';

const D = (v: string) => new Prisma.Decimal(v);
const NAV = D('1.00000000');

function envelope(opts: { amount?: string; bridge?: string; maxTime?: number; quoteId?: string; assinar?: boolean; memo?: Buffer } = {}) {
  const b = new TransactionBuilder(new Account(INV.publicKey(), '1'), { fee: '100', networkPassphrase })
    .addOperation(Operation.payment({ source: INV.publicKey(), destination: ISSUER.publicKey(), asset: new Asset('PLINARF', ISSUER.publicKey()), amount: opts.amount ?? '100' }))
    .addOperation(Operation.payment({ source: DIST.publicKey(), destination: INV.publicKey(), asset: TESOURO, amount: opts.bridge ?? '85.54' }))
    .setTimebounds(0, opts.maxTime ?? AGORA_SEC + 100)
    .addMemo(Memo.hash(opts.memo ?? memoHashDoResgate(opts.quoteId ?? 'q_1')));
  const tx = b.build();
  if (opts.assinar !== false) tx.sign(INV);
  return tx;
}

function cotacao(over: Record<string, unknown> = {}) {
  return {
    id: 'q_1', investidorId: 'inv_1', classe: 'SENIOR', plinarfAmount: D('100'), brlEquivalente: D('100.00'),
    bridgeAmount: D('85.54'), taxaBridge: '0.8554', bridgeCode: 'TESOURO', bridgeIssuer: TESOURO.getIssuer(),
    navPorTokenNaCotacao: NAV, expiresAt: new Date(AGORA + 300_000), submitXdrHash: null, submitTxHash: null,
    submitMaxTime: null, submitXdr: null, consumedAt: null, consumedTxHash: null, ...over,
  };
}
const inv = { id: 'inv_1', publicKey: INV.publicKey(), privyId: 'did:privy:abc' };

beforeEach(() => {
  process.env.STELLAR_ISSUER_PUBLIC = ISSUER.publicKey();
  process.env.STELLAR_DISTRIBUTOR_PUBLIC = DIST.publicKey();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const f of Object.values(m)) f.mockReset();
  m.create.mockResolvedValue({});
  m.updateMany.mockResolvedValue({ count: 1 });
  m.preco.mockResolvedValue({ navPorToken: NAV, brlEquivalente: D('100.00'), navTotal: 1, tokensVivos: 1 });
  m.buildResgate.mockResolvedValue({ xdr: 'XDR_BUILD', hashHex: '0xabc', maxTime: AGORA_SEC + 120 });
  m.conferencia.mockResolvedValue(undefined);
  m.fetchTx.mockResolvedValue(null);
  m.preSign.mockReturnValue({ pubkey: DIST.publicKey(), sigBase64: 'sigdist' });
  m.submitPrivy.mockResolvedValue({ hash: 'tx_hash_final' });
  m.movCreateMany.mockResolvedValue({ count: 1 });
  m.decrementar.mockResolvedValue(undefined);
  m.investidorUpdate.mockResolvedValue({});
  m.eventoCreate.mockResolvedValue({});
});

const cotarIn = (over: Record<string, unknown> = {}) => ({
  investidorId: 'inv_1', investorPubkey: INV.publicKey(), amountPlinarf: '100', taxaBrlParaBridge: '0.8554',
  bridgeAsset: { code: 'TESOURO', issuer: TESOURO.getIssuer() }, agora: AGORA, ...over,
});

describe('cotarResgate (build)', () => {
  it('persiste a cotação e devolve o contrato (strings decimais; sem assinatura da Plina)', async () => {
    const r = await cotarResgate(cotarIn());
    expect(r).toMatchObject({
      xdr: 'XDR_BUILD', hashHex: '0xabc', amountPlinarf: '100.0000000', brlEquivalente: '100.00',
      navPorTokenNaCotacao: '1.00000000', expiresAt: new Date(AGORA + 300_000).toISOString(),
    });
    expect(typeof r.quoteId).toBe('string');
    const dados = m.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({ id: r.quoteId, investidorId: 'inv_1', classe: 'SENIOR', taxaBridge: '0.8554', bridgeCode: 'TESOURO' });
    expect(dados.bridgeAmount.toFixed(7)).toBe('85.5400000'); // 100,00 × 0,8554
    expect(m.preSign).not.toHaveBeenCalled(); // a Plina não assina no build
  });

  it('o builder recebe as 2 pernas certas e o memo do resgate', async () => {
    const r = await cotarResgate(cotarIn());
    const args = m.buildResgate.mock.calls[0][0];
    expect(args).toMatchObject({
      investorPubkey: INV.publicKey(), issuerPubkey: ISSUER.publicKey(), distributorPubkey: DIST.publicKey(),
      plinarfCode: 'PLINARF', plinarfAmount: '100.0000000', bridgeAmount: '85.5400000',
    });
    expect(args.memoHash.equals(memoHashDoResgate(r.quoteId))).toBe(true);
  });

  it('com swap/resgate em conferência → recusa sem cotar nem persistir', async () => {
    m.conferencia.mockRejectedValue(new ApiError('SWAP_EM_CONFERENCIA', 409, 'em conferência'));
    await expect(cotarResgate(cotarIn())).rejects.toMatchObject({ code: 'SWAP_EM_CONFERENCIA' });
    expect(m.preco).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('quantidade inválida → 400; BRL que arredonda para 0 → 400; taxa inválida → 502; nada persistido', async () => {
    for (const a of ['0', '-1', '1.00000001', 'abc']) {
      await expect(cotarResgate(cotarIn({ amountPlinarf: a }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    }
    m.preco.mockResolvedValue({ navPorToken: NAV, brlEquivalente: D('0.00'), navTotal: 1, tokensVivos: 1 });
    await expect(cotarResgate(cotarIn({ amountPlinarf: '0.001' }))).rejects.toMatchObject({ status: 400 });
    m.preco.mockResolvedValue({ navPorToken: NAV, brlEquivalente: D('100.00'), navTotal: 1, tokensVivos: 1 });
    await expect(cotarResgate(cotarIn({ taxaBrlParaBridge: 'abc' }))).rejects.toMatchObject({ code: 'ETHERFUSE_ERROR', status: 502 });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('NAV indisponível (ledger fora, emissão/swap em voo…) propaga e nada é persistido', async () => {
    m.preco.mockRejectedValue(new NavIndisponivelError('SWAP_EM_VOO'));
    await expect(cotarResgate(cotarIn())).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('submeterResgate — caminho feliz', () => {
  it('assina como distributor SÓ no fim, submete e escritura RESGATE_PAGO (caixa −V, tokens −q) depois da chain', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    const tx = envelope();
    const r = await submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA });
    expect(r).toEqual({ txHash: 'tx_hash_final' });

    // reserva com hash, txHash, maxTime e o XDR (para a prova pela conta do investidor)
    const reserva = m.updateMany.mock.calls[0][0];
    expect(reserva.where).toEqual({ id: 'q_1', submitXdrHash: null });
    expect(reserva.data).toMatchObject({ submitTxHash: tx.hash().toString('hex'), submitXdr: tx.toXDR() });
    expect(reserva.data.submitMaxTime).toEqual(new Date((AGORA_SEC + 100) * 1000));

    // co-assinatura do distributor (investidor + distributor entram juntos)
    const envio = m.submitPrivy.mock.calls[0][0];
    expect(envio.extraSignatures).toEqual([{ pubkey: DIST.publicKey(), sigBase64: 'sigdist' }]);
    expect(envio.investorPubkey).toBe(INV.publicKey());

    // domínio depois da chain
    const mov = m.movCreateMany.mock.calls[0][0].data[0];
    expect(mov).toMatchObject({ tipo: 'RESGATE_PAGO', chave: 'resgate:q_1' });
    expect(D(String(mov.valorBrl)).toFixed(2)).toBe('100.00');
    expect(D(String(mov.deltaCaixa)).toFixed(2)).toBe('-100.00');
    expect(D(String(mov.deltaTokens)).toFixed(7)).toBe('-100.0000000');
    expect(m.decrementar.mock.calls[0][1]).toMatchObject({ investidorId: 'inv_1', classe: 'SENIOR', amount: '100.0000000', txHash: 'tx_hash_final' });
    expect(m.investidorUpdate).toHaveBeenCalledOnce();
    const audit = m.eventoCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ acao: 'PLINARF_LIQUIDADO', investidorId: 'inv_1', privyId: 'did:privy:abc', stellarTxHash: 'tx_hash_final' });
    expect(audit.payloadJson).toMatchObject({ quoteId: 'q_1', queima: true });
    // a cotação foi consumida na mesma transação
    expect(m.updateMany.mock.calls.some((c) => c[0].data?.consumedTxHash === 'tx_hash_final')).toBe(true);
  });

  it('retry com o mesmo XDR de uma cotação já consumida devolve o mesmo txHash (idempotente), sem reenviar', async () => {
    const tx = envelope();
    const hash = createHash('sha256').update(tx.hash()).digest('hex');
    m.findFirst.mockResolvedValue(cotacao({ consumedAt: new Date(), consumedTxHash: 'tx_antigo', submitXdrHash: hash }));
    expect(await submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA })).toEqual({ txHash: 'tx_antigo' });
    expect(m.submitPrivy).not.toHaveBeenCalled();
  });

  it('cotação já consumida com OUTRO xdr → 409', async () => {
    m.findFirst.mockResolvedValue(cotacao({ consumedAt: new Date(), consumedTxHash: 'tx_antigo', submitXdrHash: 'outro' }));
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: envelope().toXDR(), agora: AGORA })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});

describe('submeterResgate — recusas antes de a Plina assinar', () => {
  const tenta = (tx = envelope(), agora = AGORA) =>
    submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora });
  const nadaAssinado = () => {
    expect(m.preSign).not.toHaveBeenCalled();
    expect(m.submitPrivy).not.toHaveBeenCalled();
  };

  it('OWNERSHIP: a busca filtra pelo investidor da sessão; cotação de outro → 404', async () => {
    m.findFirst.mockResolvedValue(null);
    await expect(tenta()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'q_1', investidorId: 'inv_1' } });
    nadaAssinado();
  });

  it('assinatura do investidor ausente ou xdr inválida → 400', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    await expect(tenta(envelope({ assinar: false }))).rejects.toMatchObject({ status: 400 });
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: 'lixo', agora: AGORA })).rejects.toMatchObject({ status: 400 });
    nadaAssinado();
  });

  it('cotação vencida (sem reserva) → 410 COTACAO_EXPIRADA', async () => {
    m.findFirst.mockResolvedValue(cotacao({ expiresAt: new Date(AGORA - 1000) }));
    await expect(tenta()).rejects.toMatchObject({ code: 'COTACAO_EXPIRADA', status: 410 });
    nadaAssinado();
  });

  it('XDR divergente da cotação (valor da queima, TESOURO, memo) → 400 e nada reservado', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    for (const ruim of [envelope({ amount: '101' }), envelope({ bridge: '99' }), envelope({ memo: memoHashDoResgate('q_outro') })]) {
      await expect(tenta(ruim)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    }
    expect(m.updateMany).not.toHaveBeenCalled();
    nadaAssinado();
  });

  it('janela de validade: maxTime longe demais (10 anos) → 400', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    await expect(tenta(envelope({ maxTime: AGORA_SEC + 315_360_000 }))).rejects.toMatchObject({ status: 400 });
    nadaAssinado();
  });

  it('NAV mudou além de 1 bp desde a cotação → 409 NAV_MUDOU (recotar), sem reservar', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.preco.mockResolvedValue({ navPorToken: D('1.10000000'), brlEquivalente: D('110.00'), navTotal: 1, tokensVivos: 1 });
    await expect(tenta()).rejects.toMatchObject({ code: 'NAV_MUDOU', status: 409 });
    expect(m.updateMany).not.toHaveBeenCalled();
    nadaAssinado();
  });

  it('NAV indisponível ao reler → propaga (503 na rota), sem reservar', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.preco.mockRejectedValue(new NavIndisponivelError('LEDGER_LEITURA_FALHOU'));
    await expect(tenta()).rejects.toBeInstanceOf(NavIndisponivelError);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('outro swap/resgate do MESMO investidor em conferência → 409 SWAP_EM_CONFERENCIA, sem reservar', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.conferencia.mockRejectedValue(new ApiError('SWAP_EM_CONFERENCIA', 409, 'em conferência'));
    await expect(tenta()).rejects.toMatchObject({ code: 'SWAP_EM_CONFERENCIA' });
    expect(m.conferencia).toHaveBeenCalledWith('inv_1', { ignorarResgateId: 'q_1' });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('cotação já reservada por OUTRO xdr → 409', async () => {
    m.findFirst.mockResolvedValue(cotacao({ submitXdrHash: 'hash_de_outro_xdr' }));
    await expect(tenta()).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    nadaAssinado();
  });

  it('perdeu a corrida da reserva (outro request reservou outro xdr) → 409', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    m.findUnique.mockResolvedValue({ submitXdrHash: 'outro' });
    await expect(tenta()).rejects.toMatchObject({ code: 'CONFLICT' });
    nadaAssinado();
  });
});

describe('submeterResgate — reserva órfã (mesma regra do swap, N1-S1)', () => {
  const orfaCom = (tx: ReturnType<typeof envelope>) => {
    const hash = createHash('sha256').update(tx.hash()).digest('hex');
    m.findFirst.mockResolvedValue(cotacao({ submitXdrHash: hash }));
    m.updateMany.mockResolvedValueOnce({ count: 0 }); // a reserva já existe
    return hash;
  };

  it('dentro do maxTime e fora da chain: re-assina e reenvia; NÃO relê o NAV nem bloqueia por outra operação', async () => {
    const tx = envelope();
    orfaCom(tx);
    const r = await submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA });
    expect(r.txHash).toBe('tx_hash_final');
    expect(m.preco).not.toHaveBeenCalled();
    expect(m.conferencia).not.toHaveBeenCalled();
    expect(m.submitPrivy).toHaveBeenCalledOnce();
  });

  it('a tx JÁ está na chain com sucesso: escritura sem assinar nem reenviar', async () => {
    const tx = envelope();
    orfaCom(tx);
    m.fetchTx.mockResolvedValue({ hash: 'tx_na_chain', successful: true });
    expect(await submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA })).toEqual({ txHash: 'tx_na_chain' });
    expect(m.preSign).not.toHaveBeenCalled();
    expect(m.submitPrivy).not.toHaveBeenCalled();
    expect(m.movCreateMany).toHaveBeenCalledOnce();
  });

  it('a tx entrou e FALHOU na chain: libera a reserva (prova positiva) e devolve 409, sem escriturar', async () => {
    const tx = envelope();
    const hash = orfaCom(tx);
    m.fetchTx.mockResolvedValue({ hash: 'x', successful: false });
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA })).rejects.toMatchObject({ status: 409 });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'q_1', submitXdrHash: hash, consumedAt: null },
      data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null },
    });
    expect(m.movCreateMany).not.toHaveBeenCalled();
  });

  it('DEPOIS do maxTime e fora da chain: 410, a Plina NUNCA assina e NÃO libera por "não achei"', async () => {
    const tx = envelope({ maxTime: AGORA_SEC - 600 });
    orfaCom(tx);
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: tx.toXDR(), agora: AGORA })).rejects.toMatchObject({ code: 'COTACAO_EXPIRADA', status: 410 });
    expect(m.preSign).not.toHaveBeenCalled();
    expect(m.submitPrivy).not.toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledTimes(1); // só a tentativa de reserva: nada liberado
  });
});

describe('submeterResgate — falha do Horizon', () => {
  it('o submit falha: a reserva fica (a órfã é resolvida depois), nada é escriturado e o erro propaga', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.submitPrivy.mockRejectedValue(new Error('horizon 504'));
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: envelope().toXDR(), agora: AGORA })).rejects.toThrow('horizon 504');
    expect(m.movCreateMany).not.toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledTimes(1); // só a reserva; sem liberar
  });

  it('o signer do distributor diferente da configuração → erro, sem submeter', async () => {
    m.findFirst.mockResolvedValue(cotacao());
    m.preSign.mockReturnValue({ pubkey: Keypair.random().publicKey(), sigBase64: 'x' });
    await expect(submeterResgate({ investidor: inv, quoteId: 'q_1', signedXdr: envelope().toXDR(), agora: AGORA })).rejects.toThrow(/signer/);
    expect(m.submitPrivy).not.toHaveBeenCalled();
  });
});
