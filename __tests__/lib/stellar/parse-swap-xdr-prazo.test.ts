import { describe, it, expect } from 'vitest';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

/**
 * N1 C1 (Vera, passagens/2026-11-10-vera-n1.md): o investidor monta e assina o
 * envelope do swap e o issuer co-assina, então a janela de validade tem de ser
 * curta e já aberta. Regra: timeBounds presente; 0 < maxTime ≤ agora + 180 s
 * (120 s do build + 60 s de relógio); minTime ≤ agora + 5 s. Relógio do servidor.
 */
const INVESTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const DISTRIBUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const TESOURO_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
const BRIDGE = { code: 'TESOURO', issuer: TESOURO_ISSUER };

const AGORA = 1_800_000_000;
const ESPERADO = {
  investorPubkey: INVESTOR,
  distributorPubkey: DISTRIBUTOR,
  issuerPubkey: ISSUER,
  bridgeAsset: BRIDGE,
  expectedBridgeAmount: '99.5000000',
  expectedPlinarfAmount: '99.5000000',
};

function xdr(janela: { minTime?: number; maxTime?: number }): string {
  return new TransactionBuilder(new Account(INVESTOR, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: janela.minTime ?? 0, maxTime: janela.maxTime ?? 0 },
  })
    .addOperation(Operation.payment({ source: INVESTOR, destination: DISTRIBUTOR, asset: new Asset('TESOURO', TESOURO_ISSUER), amount: '99.5000000' }))
    .addOperation(Operation.payment({ source: ISSUER, destination: INVESTOR, asset: new Asset('PLINARF', ISSUER), amount: '99.5000000' }))
    .build()
    .toXDR();
}
// "sem timeBounds nenhum" é coberto pelo teste da Vera (parse-swap-xdr-ataques.test.ts).

const valida = (x: string) => () => assertSwapXdrMatchesQuote(x, ESPERADO, { agoraSec: AGORA });

describe('assertSwapXdrMatchesQuote — janela de validade (N1 C1)', () => {
  it('aceita a janela do build: minTime 0, maxTime = agora + 120', () => {
    expect(valida(xdr({ maxTime: AGORA + 120 }))).not.toThrow();
  });

  it('aceita até agora + 180 (margem de relógio) e recusa agora + 181', () => {
    expect(valida(xdr({ maxTime: AGORA + 180 }))).not.toThrow();
    expect(valida(xdr({ maxTime: AGORA + 181 }))).toThrow(/maxTime/);
  });

  it('recusa maxTime 0 (sem prazo)', () => {
    expect(valida(xdr({ maxTime: 0 }))).toThrow(/maxTime/);
  });

  it('recusa minTime no futuro além de 5 s; aceita até 5 s', () => {
    expect(valida(xdr({ minTime: AGORA + 5, maxTime: AGORA + 120 }))).not.toThrow();
    expect(valida(xdr({ minTime: AGORA + 6, maxTime: AGORA + 120 }))).toThrow(/minTime/);
  });

  it('tx já expirada passa (quem barra é a rede)', () => {
    expect(valida(xdr({ maxTime: AGORA - 3600 }))).not.toThrow();
  });

  it('sem agoraSec usa o relógio do servidor', () => {
    const agoraReal = Math.floor(Date.now() / 1000);
    expect(() => assertSwapXdrMatchesQuote(xdr({ maxTime: agoraReal + 120 }), ESPERADO)).not.toThrow();
    expect(() => assertSwapXdrMatchesQuote(xdr({ maxTime: agoraReal + 3600 }), ESPERADO)).toThrow(/maxTime/);
  });

  it('a mensagem de erro não ecoa o XDR', () => {
    const x = xdr({ maxTime: 0 });
    expect(valida(x)).toThrow();
    try {
      valida(x)();
    } catch (e) {
      expect((e as Error).message).not.toContain(x.slice(0, 40));
    }
  });
});
