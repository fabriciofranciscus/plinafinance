import { describe, it, expect } from 'vitest';
import { Account, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
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

type Extras = {
  ledgerbounds?: { minLedger?: number; maxLedger?: number };
  minAccountSequence?: string;
  minAccountSequenceAge?: number;
  minAccountSequenceLedgerGap?: number;
  extraSigners?: string[];
  memo?: Memo;
};

function xdr(janela: { minTime?: number; maxTime?: number }, extras: Extras = {}): string {
  const { memo, ...precond } = extras;
  const b = new TransactionBuilder(new Account(INVESTOR, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: janela.minTime ?? 0, maxTime: janela.maxTime ?? 0 },
    ...precond,
  })
    .addOperation(Operation.payment({ source: INVESTOR, destination: DISTRIBUTOR, asset: new Asset('TESOURO', TESOURO_ISSUER), amount: '99.5000000' }))
    .addOperation(Operation.payment({ source: ISSUER, destination: INVESTOR, asset: new Asset('PLINARF', ISSUER), amount: '99.5000000' }));
  if (memo) b.addMemo(memo);
  return b.build().toXDR();
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

describe('assertSwapXdrMatchesQuote — HIGH N1-S1 do Argus (prazo do quote e precondições v2)', () => {
  const OK = { maxTime: AGORA + 120 };
  const comQuote = (x: string, quoteExpiresAt: Date, extra: Record<string, unknown> = {}) => () =>
    assertSwapXdrMatchesQuote(x, { ...ESPERADO, quoteExpiresAt, ...extra }, { agoraSec: AGORA });

  it('maxTime até quote.expiresAt + 120 s passa; além disso recusa', () => {
    const expira = new Date((AGORA + 30) * 1000);
    expect(comQuote(xdr({ maxTime: AGORA + 150 }), expira)).not.toThrow();
    expect(comQuote(xdr({ maxTime: AGORA + 151 }), expira)).toThrow(/quote/);
  });

  it('quote já vencido há tempo: envelope com maxTime atual é recusado', () => {
    const venceuOntem = new Date((AGORA - 86_400) * 1000);
    expect(comQuote(xdr(OK), venceuOntem)).toThrow(/quote/);
  });

  it('quoteExpiresAt inválido → recusa (fail-closed)', () => {
    expect(comQuote(xdr(OK), new Date('x'))).toThrow(/quoteExpiresAt/);
  });

  it.each<[string, Extras]>([
    ['ledgerBounds', { ledgerbounds: { minLedger: 1, maxLedger: 999_999_999 } }],
    ['minAccountSequence (vetor do HIGH: atual + 2)', { minAccountSequence: '0' }],
    ['minAccountSequenceAge ≠ 0', { minAccountSequenceAge: 60 }],
    ['minAccountSequenceLedgerGap ≠ 0', { minAccountSequenceLedgerGap: 5 }],
    ['extraSigners', { extraSigners: [Keypair.random().publicKey()] }],
  ])('recusa precondição v2: %s', (_nome, extras) => {
    expect(valida(xdr(OK, extras))).toThrow(/precondi/);
  });

  it('memo: com memoTexto exige o mesmo texto do build; outro memo ou ausente → recusa', () => {
    const memoTexto = 'q:quote-123';
    const comMemo = (m?: Memo) => () =>
      assertSwapXdrMatchesQuote(xdr(OK, m ? { memo: m } : {}), { ...ESPERADO, memoTexto }, { agoraSec: AGORA });
    expect(comMemo(Memo.text(memoTexto))).not.toThrow();
    expect(comMemo(Memo.text('q:outro'))).toThrow(/memo/);
    expect(comMemo(Memo.hash(Buffer.alloc(32, 1).toString('hex')))).toThrow(/memo/);
    expect(comMemo()).toThrow(/memo/);
  });

  it('sem os campos novos na expectativa, o comportamento anterior se mantém', () => {
    expect(valida(xdr(OK))).not.toThrow();
  });
});
