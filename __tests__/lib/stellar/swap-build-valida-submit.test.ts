/**
 * Costura build → submit: o envelope que o builder REAL do swap gera (com o memo do build e a janela
 * padrão) tem de passar no validador REAL com as mesmas expectativas que o submit usa
 * (quoteExpiresAt e memoTexto). Se alguém mudar o memo, a janela ou o formato de um lado só, o
 * swap legítimo passa a ser recusado em produção sem que nenhum teste unitário isolado perceba.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, Asset, Keypair } from '@stellar/stellar-sdk';
import { horizon } from '@/lib/stellar/account';
import { buildSwapBridgeForPlinarfXdr } from '@/lib/stellar/transactions';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

const INV = Keypair.random().publicKey();
const DIST = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const BRIDGE_ISSUER = Keypair.random().publicKey();
const QUOTE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function construir(quoteId = QUOTE_ID) {
  vi.spyOn(horizon, 'loadAccount').mockResolvedValue(
    // N1-at: investidor com trustline PLINARF autorizada.
    Object.assign(new Account(INV, '100'), { balances: [{ asset_type: 'credit_alphanum12', asset_code: 'PLINARF', asset_issuer: ISSUER, balance: '0', is_authorized: true }] }) as never,
  );
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  return buildSwapBridgeForPlinarfXdr({
    investorPubkey: INV,
    bridgeAsset: new Asset('TESOURO', BRIDGE_ISSUER),
    bridgeAmount: '1000.0000000',
    plinarfAmount: '950.0000000',
    issuerPubkey: ISSUER,
    distributorPubkey: DIST,
    plinarfCode: 'PLINARF',
    memo: `q:${quoteId.slice(0, 24)}`,
  });
}
const ESPERADO = {
  investorPubkey: INV,
  distributorPubkey: DIST,
  issuerPubkey: ISSUER,
  bridgeAsset: { code: 'TESOURO', issuer: BRIDGE_ISSUER },
  expectedBridgeAmount: '1000.0000000',
  expectedPlinarfAmount: '950.0000000',
  plinarfCode: 'PLINARF',
};

describe('build → validador do submit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('o envelope legítimo do build passa com quoteExpiresAt e memoTexto como o submit os passa', async () => {
    const { xdr } = await construir();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, { ...ESPERADO, quoteExpiresAt: expiresAt, memoTexto: `q:${QUOTE_ID.slice(0, 24)}` }),
    ).not.toThrow();
  });

  it('passa mesmo com o quote quase expirado (o maxTime de 120 s cabe em expiresAt + 120 s)', async () => {
    const { xdr } = await construir();
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, { ...ESPERADO, quoteExpiresAt: new Date(Date.now() + 5_000), memoTexto: `q:${QUOTE_ID.slice(0, 24)}` }),
    ).not.toThrow();
  });

  it('o mesmo envelope é recusado se o submit apontar OUTRO quote (memo diferente)', async () => {
    const { xdr } = await construir();
    expect(() =>
      assertSwapXdrMatchesQuote(xdr, { ...ESPERADO, quoteExpiresAt: new Date(Date.now() + 60_000), memoTexto: 'q:outro-quote-qualquer-1234' }),
    ).toThrow();
  });
});
