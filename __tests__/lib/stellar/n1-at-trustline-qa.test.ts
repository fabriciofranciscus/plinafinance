import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, Asset, Keypair, Operation, TransactionBuilder, Transaction, MuxedAccount } from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import { submitWithPrivySignature } from '@/lib/stellar/transactions';
import {
  TrustlineNaoAutorizadaError,
  exigirEmissoesParaTrustlineAutorizada,
  exigirTrustlineAutorizada,
  pernasDeEmissao,
} from '@/lib/stellar/trustline';

/** QA Vera — bordas do N1-at (trustline.ts). Hermético: Horizon só por spy. */
const INVESTOR = Keypair.random();
const OUTRO = Keypair.random();
const ISSUER = Keypair.random().publicKey();
const IMPOSTOR = Keypair.random().publicKey();
const DIST = Keypair.random().publicKey();
const PLINARF = new Asset('PLINARF', ISSUER);
const PLINARFB = new Asset('PLINARFB', ISSUER);

const linha = (code: string, issuer: string, is_authorized: unknown) => ({
  asset_type: "credit_alphanum12", asset_code: code, asset_issuer: issuer, balance: "0", is_authorized: is_authorized as boolean,
});
const conta = (id: string, balances: unknown[]) =>
  Object.assign(new Account(id, '1'), { balances }) as never;

function tx(ops: ReturnType<typeof Operation.payment>[], source = INVESTOR.publicKey()) {
  const b = new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase });
  ops.forEach((o) => b.addOperation(o));
  return b.setTimeout(60).build();
}
const emissao = (dest: string, asset = PLINARF) =>
  Operation.payment({ source: ISSUER, destination: dest, asset, amount: '1' });

beforeEach(() => {
  vi.restoreAllMocks();
  _resetFeeCacheForTests();
  vi.spyOn(horizon, 'submitTransaction').mockResolvedValue({ hash: 'h', successful: true } as never);
});

describe('exigirTrustlineAutorizada — bordas', () => {
  const H = INVESTOR.publicKey();
  it('mesmo code com issuer IMPOSTOR autorizado não vale: TRUSTLINE_AUSENTE', () => {
    expect(() => exigirTrustlineAutorizada([linha('PLINARF', IMPOSTOR, true)], 'PLINARF', ISSUER, H)).toThrowError(
      expect.objectContaining({ code: 'TRUSTLINE_AUSENTE' }),
    );
  });
  it('mesmo issuer com OUTRO code (PLINARFB autorizada não cobre PLINARF)', () => {
    expect(() => exigirTrustlineAutorizada([linha('PLINARFB', ISSUER, true)], 'PLINARF', ISSUER, H)).toThrowError(
      expect.objectContaining({ code: 'TRUSTLINE_AUSENTE' }),
    );
  });
  it('só is_authorized === true vale: "true", 1, null e ausente são recusados (NAO_AUTORIZADA)', () => {
    for (const v of ['true', 1, null, undefined, 'yes']) {
      expect(() => exigirTrustlineAutorizada([linha('PLINARF', ISSUER, v)], 'PLINARF', ISSUER, H)).toThrowError(
        expect.objectContaining({ code: 'TRUSTLINE_NAO_AUTORIZADA' }),
      );
    }
  });
  it('fail-closed: balances undefined, null e [] contam como AUSENTE; erro carrega holder e asset, mensagem fixa sem endereço', () => {
    for (const b of [undefined, null as never, []]) {
      try {
        exigirTrustlineAutorizada(b, 'PLINARF', ISSUER, H);
        throw new Error('deveria lançar');
      } catch (e) {
        const err = e as TrustlineNaoAutorizadaError;
        expect(err).toBeInstanceOf(TrustlineNaoAutorizadaError);
        expect(err.code).toBe('TRUSTLINE_AUSENTE');
        expect(err.holder).toBe(H);
        expect(err.asset).toBe(`PLINARF:${ISSUER}`);
        expect(err.message).not.toContain(H);
        expect(err.message).not.toContain(ISSUER);
      }
    }
  });
  it('se há 2 linhas do mesmo asset, a primeira decide (find) — Horizon nunca devolve duplicata; caracterização', () => {
    expect(() =>
      exigirTrustlineAutorizada([linha('PLINARF', ISSUER, false), linha('PLINARF', ISSUER, true)], 'PLINARF', ISSUER, H),
    ).toThrowError(expect.objectContaining({ code: 'TRUSTLINE_NAO_AUTORIZADA' }));
  });
  it('linha nativa e de liquidity pool (sem asset_code) são ignoradas', () => {
    expect(() =>
      exigirTrustlineAutorizada([{ asset_type: 'native' }, { asset_type: 'liquidity_pool_shares' }] as never, 'PLINARF', ISSUER, H),
    ).toThrowError(expect.objectContaining({ code: 'TRUSTLINE_AUSENTE' }));
  });
});

describe('pernasDeEmissao — bordas', () => {
  it('source da tx = issuer e op sem source: é emissão (cai no source da tx)', () => {
    const t = tx([Operation.payment({ destination: INVESTOR.publicKey(), asset: PLINARF, amount: '1' })], ISSUER);
    expect(pernasDeEmissao(t)).toEqual([{ destination: INVESTOR.publicKey(), code: 'PLINARF', issuer: ISSUER }]);
  });
  it('source da tx = issuer, mas op com source de TERCEIRO: não é emissão', () => {
    const t = tx([Operation.payment({ source: OUTRO.publicKey(), destination: INVESTOR.publicKey(), asset: PLINARF, amount: '1' })], ISSUER);
    expect(pernasDeEmissao(t)).toEqual([]);
  });
  it('payment de XLM nativo e payment de PLINARF do investidor para terceiro não são emissão', () => {
    const t = tx([
      Operation.payment({ source: ISSUER, destination: INVESTOR.publicKey(), asset: Asset.native(), amount: '1' }),
      Operation.payment({ source: INVESTOR.publicKey(), destination: OUTRO.publicKey(), asset: PLINARF, amount: '1' }),
    ]);
    expect(pernasDeEmissao(t)).toEqual([]);
  });
  it('várias pernas: todas listadas, na ordem, com code correto (PLINARF e PLINARFB)', () => {
    const t = tx([emissao(INVESTOR.publicKey()), emissao(OUTRO.publicKey(), PLINARFB)]);
    expect(pernasDeEmissao(t)).toEqual([
      { destination: INVESTOR.publicKey(), code: 'PLINARF', issuer: ISSUER },
      { destination: OUTRO.publicKey(), code: 'PLINARFB', issuer: ISSUER },
    ]);
  });
  it('destino muxed (M…): a perna é detectada e devolve o endereço M (o Horizon não carrega M como conta → recusa fail-closed)', () => {
    const muxed = new MuxedAccount(new Account(INVESTOR.publicKey(), '1'), '7').accountId();
    const t = tx([Operation.payment({ source: ISSUER, destination: muxed, asset: PLINARF, amount: '1' })]);
    const pernas = pernasDeEmissao(t);
    expect(pernas).toHaveLength(1);
    expect(pernas[0].destination.startsWith('M')).toBe(true);
  });
  it('payment issuer → issuer (destino = o próprio issuer) não é perna de emissão', () => {
    const t = tx([Operation.payment({ source: ISSUER, destination: ISSUER, asset: PLINARF, amount: '1' })]);
    expect(pernasDeEmissao(t)).toEqual([]);
  });
  it('LACUNA (INFO, caracterização): path payment com source=issuer NÃO é coberto — o builder do produto só usa payment', () => {
    const t = new TransactionBuilder(new Account(INVESTOR.publicKey(), '1'), { fee: '100', networkPassphrase })
      .addOperation(
        Operation.pathPaymentStrictReceive({
          source: ISSUER, sendAsset: PLINARF, sendMax: '2', destination: INVESTOR.publicKey(), destAsset: PLINARF, destAmount: '1', path: [],
        }),
      )
      .setTimeout(60)
      .build();
    expect(pernasDeEmissao(t)).toEqual([]);
  });
});

describe('exigirEmissoesParaTrustlineAutorizada / submitWithPrivySignature — bordas', () => {
  it('duas pernas: uma autorizada e uma não → recusa, e o submit nunca acontece', async () => {
    const A = INVESTOR.publicKey();
    const B = OUTRO.publicKey();
    vi.spyOn(horizon, 'loadAccount').mockImplementation(async (id: string) =>
      conta(id, [linha('PLINARF', ISSUER, id === A)]),
    );
    const t = tx([emissao(A), emissao(B)]);
    const err = await exigirEmissoesParaTrustlineAutorizada(t).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrustlineNaoAutorizadaError);
    expect((err as TrustlineNaoAutorizadaError).holder).toBe(B);
    const sig = '0x' + INVESTOR.sign(t.hash()).toString('hex');
    await expect(
      submitWithPrivySignature({ xdr: t.toXDR(), investorPubkey: A, investorSignatureHex: sig }),
    ).rejects.toBeInstanceOf(TrustlineNaoAutorizadaError);
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });
  it('conta inexistente no Horizon (404) propaga o erro do Horizon e NÃO submete (fail-closed)', async () => {
    vi.spyOn(horizon, 'loadAccount').mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    const t = tx([emissao(INVESTOR.publicKey())]);
    const sig = '0x' + INVESTOR.sign(t.hash()).toString('hex');
    await expect(
      submitWithPrivySignature({ xdr: t.toXDR(), investorPubkey: INVESTOR.publicKey(), investorSignatureHex: sig }),
    ).rejects.toThrow('Not Found');
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });
  it('a guarda roda ANTES de assinar/enviar: assinatura inválida não esconde a recusa de trustline', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(conta(INVESTOR.publicKey(), []));
    const t = tx([emissao(INVESTOR.publicKey())]);
    await expect(
      submitWithPrivySignature({ xdr: t.toXDR(), investorPubkey: INVESTOR.publicKey(), investorSignatureHex: '0x00' }),
    ).rejects.toMatchObject({ code: 'TRUSTLINE_AUSENTE' });
  });
  it('perna de burn (investidor → issuer) e tx só de TESOURO não consultam o Horizon', async () => {
    const load = vi.spyOn(horizon, 'loadAccount');
    const t = tx([Operation.payment({ source: INVESTOR.publicKey(), destination: ISSUER, asset: PLINARF, amount: '1' })]);
    await exigirEmissoesParaTrustlineAutorizada(t);
    expect(load).not.toHaveBeenCalled();
  });
  it('trustline autorizada com a conta já carregada: envia o XDR com a assinatura do investidor', async () => {
    vi.spyOn(horizon, 'loadAccount').mockResolvedValue(conta(INVESTOR.publicKey(), [linha('PLINARF', ISSUER, true)]));
    const t = tx([emissao(INVESTOR.publicKey())]);
    const sig = '0x' + INVESTOR.sign(t.hash()).toString('hex');
    await submitWithPrivySignature({ xdr: t.toXDR(), investorPubkey: INVESTOR.publicKey(), investorSignatureHex: sig });
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(1);
    const enviada = (horizon.submitTransaction as unknown as { mock: { calls: Transaction[][] } }).mock.calls[0][0];
    expect(enviada.signatures.length).toBeGreaterThanOrEqual(1);
  });
});
