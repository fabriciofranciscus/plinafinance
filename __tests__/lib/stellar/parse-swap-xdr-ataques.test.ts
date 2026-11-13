/**
 * N1 — o issuer co-assina o envelope que o INVESTIDOR monta e assina. Estes testes tratam o
 * validador (`assertSwapXdrMatchesQuote`) como a única barreira entre um XDR hostil e a assinatura
 * do issuer, e tentam enganá-lo: operações extras, pernas trocadas, origem/destino/valor/ativo
 * adulterados, conta multiplexada, envelope fee-bump. O bloco final registra com `it.fails` os
 * limites que o validador NÃO impõe hoje (janela de validade da tx); quando forem fechados, esses
 * testes falham e devem virar `it` normal.
 */
import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  MuxedAccount,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';

const INV = Keypair.random();
const DIST = Keypair.random();
const ISSUER = Keypair.random();
const BRIDGE_ISSUER = Keypair.random();
const ATACANTE = Keypair.random();
const BRIDGE = new Asset('TESOURO', BRIDGE_ISSUER.publicKey());
const PLINARF = new Asset('PLINARF', ISSUER.publicKey());

const ESPERADO = {
  investorPubkey: INV.publicKey(),
  distributorPubkey: DIST.publicKey(),
  issuerPubkey: ISSUER.publicKey(),
  bridgeAsset: { code: 'TESOURO', issuer: BRIDGE_ISSUER.publicKey() },
  expectedBridgeAmount: '1000.0000000',
  expectedPlinarfAmount: '950.0000000',
  plinarfCode: 'PLINARF',
};

type Ops = xdr.Operation[];
const leg1 = (o: { amount?: string; destination?: string; asset?: Asset } = {}) =>
  Operation.payment({
    destination: o.destination ?? DIST.publicKey(),
    asset: o.asset ?? BRIDGE,
    amount: o.amount ?? '1000.0000000',
  });
const leg2 = (o: { amount?: string; destination?: string; asset?: Asset; source?: string | null } = {}) =>
  Operation.payment({
    ...(o.source === null ? {} : { source: o.source ?? ISSUER.publicKey() }),
    destination: o.destination ?? INV.publicKey(),
    asset: o.asset ?? PLINARF,
    amount: o.amount ?? '950.0000000',
  });

function tx(
  ops: Ops,
  o: { source?: string; maxTime?: number; minTime?: number; memo?: Memo; semTimeBounds?: boolean } = {},
): Transaction {
  const b = new TransactionBuilder(new Account(o.source ?? INV.publicKey(), '100'), {
    fee: BASE_FEE,
    networkPassphrase,
    timebounds: {
      minTime: o.minTime ?? 0,
      maxTime: o.maxTime ?? Math.floor(Date.now() / 1000) + 120,
    },
    ...(o.memo ? { memo: o.memo } : {}),
  });
  for (const op of ops) b.addOperation(op);
  const t = b.build();
  if (o.semTimeBounds) {
    const env = t.toEnvelope();
    env.v1().tx().cond(xdr.Preconditions.precondNone());
    return new Transaction(env, networkPassphrase);
  }
  return t;
}
const xdrDe = (t: Transaction) => t.toXDR();
const valido = () => tx([leg1(), leg2()]);

describe('swap XDR hostil — o validador tem de recusar (nada disto pode chegar à assinatura do issuer)', () => {
  it('base: o envelope legítimo passa', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrDe(valido()), ESPERADO)).not.toThrow();
  });

  const hostis: Array<[string, () => string]> = [
    ['3ª operação com origem no issuer (setOptions, mudaria o próprio issuer)', () => xdrDe(tx([leg1(), leg2(), Operation.setOptions({ source: ISSUER.publicKey(), homeDomain: 'evil.example' })]))],
    ['3ª operação: pagamento extra do issuer ao atacante', () => xdrDe(tx([leg1(), leg2(), Operation.payment({ source: ISSUER.publicKey(), destination: ATACANTE.publicKey(), asset: PLINARF, amount: '1000000.0000000' })]))],
    ['3ª operação: clawback pelo issuer', () => xdrDe(tx([leg1(), leg2(), Operation.clawback({ source: ISSUER.publicKey(), from: INV.publicKey(), asset: PLINARF, amount: '1.0000000' })]))],
    ['só 1 operação (sem a perna do issuer)', () => xdrDe(tx([leg1()]))],
    ['sem nenhuma operação a mais que a perna do issuer (só a perna 2)', () => xdrDe(tx([leg2()]))],
    ['pernas em ordem trocada', () => xdrDe(tx([leg2(), leg1()]))],
    ['perna 2 com origem no distributor', () => xdrDe(tx([leg1(), leg2({ source: DIST.publicKey() })]))],
    ['perna 2 sem origem explícita (herdaria o investidor)', () => xdrDe(tx([leg1(), leg2({ source: null })]))],
    ['perna 2 para o atacante', () => xdrDe(tx([leg1(), leg2({ destination: ATACANTE.publicKey() })]))],
    ['perna 2 com 1 stroop a mais', () => xdrDe(tx([leg1(), leg2({ amount: '950.0000001' })]))],
    ['perna 2 com outro código de ativo', () => xdrDe(tx([leg1(), leg2({ asset: new Asset('PLINARFB', ISSUER.publicKey()) })]))],
    ['perna 2 com o mesmo código de OUTRO emissor', () => xdrDe(tx([leg1(), leg2({ asset: new Asset('PLINARF', ATACANTE.publicKey()) })]))],
    ['perna 2 em XLM nativo', () => xdrDe(tx([leg1(), leg2({ asset: Asset.native() })]))],
    ['perna 1 com 1 stroop a menos', () => xdrDe(tx([leg1({ amount: '999.9999999' }), leg2()]))],
    ['perna 1 para o atacante', () => xdrDe(tx([leg1({ destination: ATACANTE.publicKey() }), leg2()]))],
    ['perna 1 em ativo diferente (XLM)', () => xdrDe(tx([leg1({ asset: Asset.native() }), leg2()]))],
    ['conta de origem da tx diferente do investidor da sessão', () => xdrDe(tx([leg1(), leg2()], { source: ATACANTE.publicKey() }))],
    ['destino da perna 2 em conta multiplexada (M…) do próprio investidor', () => {
      const muxed = new MuxedAccount(new Account(INV.publicKey(), '0'), '1234').accountId();
      return xdrDe(tx([leg1(), leg2({ destination: muxed })]));
    }],
    ['operação que não é payment (manageData) no lugar da perna 1', () => xdrDe(tx([Operation.manageData({ name: 'x', value: 'y' }), leg2()]))],
  ];
  for (const [nome, fazer] of hostis) {
    it(`recusa: ${nome}`, () => {
      expect(() => assertSwapXdrMatchesQuote(fazer(), ESPERADO)).toThrow();
    });
  }

  it('recusa envelope fee-bump (não é um Transaction comum)', () => {
    const interna = valido();
    interna.sign(INV);
    const bump = TransactionBuilder.buildFeeBumpTransaction(ATACANTE, '200', interna, networkPassphrase);
    expect(() => assertSwapXdrMatchesQuote(bump.toXDR(), ESPERADO)).toThrow();
  });

  it('recusa lixo e XDR vazio', () => {
    expect(() => assertSwapXdrMatchesQuote('AAAA', ESPERADO)).toThrow();
    expect(() => assertSwapXdrMatchesQuote('', ESPERADO)).toThrow();
  });

  it('recusa expectativa malformada (nunca compara frouxo)', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrDe(valido()), { ...ESPERADO, expectedPlinarfAmount: '950' })).toThrow();
    expect(() => assertSwapXdrMatchesQuote(xdrDe(valido()), { ...ESPERADO, expectedBridgeAmount: '0.0000000' })).toThrow();
  });
});

/**
 * LIMITE (achado da revisão do N1): o validador não olha `timeBounds`. O investidor monta e
 * assina o envelope, então ele escolhe a janela de validade; o issuer co-assina um envelope que
 * pode valer para sempre (maxTime 0), por anos, ou só no futuro (minTime). Hoje cada teste abaixo
 * PASSA no validador (a recusa esperada NÃO acontece), por isso `it.fails`: quando o validador
 * passar a exigir uma janela curta e já aberta, estes testes falham e viram `it`.
 */
describe('swap XDR — janela de validade (N1 C1, fechada)', () => {
  const agora = () => Math.floor(Date.now() / 1000);
  const recusa = (t: Transaction) => expect(() => assertSwapXdrMatchesQuote(xdrDe(t), ESPERADO)).toThrow();

  it('recusa tx sem janela de validade (maxTime 0 = vale para sempre)', () => {
    recusa(tx([leg1(), leg2()], { maxTime: 0 }));
  });
  it('recusa tx sem timeBounds nenhum (precondNone)', () => {
    recusa(tx([leg1(), leg2()], { semTimeBounds: true }));
  });
  it('recusa tx válida por 10 anos', () => {
    recusa(tx([leg1(), leg2()], { maxTime: agora() + 10 * 365 * 86400 }));
  });
  it('recusa tx que só passa a valer amanhã (minTime no futuro)', () => {
    recusa(tx([leg1(), leg2()], { minTime: agora() + 86400, maxTime: agora() + 2 * 86400 }));
  });
  it('(sanidade) tx já expirada passa no validador; quem barra é a rede, não a Plina', () => {
    expect(() => assertSwapXdrMatchesQuote(xdrDe(tx([leg1(), leg2()], { maxTime: agora() - 3600 })), ESPERADO)).not.toThrow();
  });
});

/**
 * N1-S1 (Argus): as pré-condições v2 da tx também são controladas pelo investidor. Com uma sequence
 * "no futuro" (minAccountSequence), uma idade mínima de sequence, um ledgerBounds ou um extraSigners
 * o envelope fica pendente e só passa a valer depois, no preço velho. O validador deve recusar todos.
 * Hoje aceita (it.fails). Quando fechar, viram `it`.
 */
describe('swap XDR — pré-condições v2 (N1-S1, fechadas)', () => {
  const agora = () => Math.floor(Date.now() / 1000);
  function comOpcoes(extra: Record<string, unknown>): string {
    const b = new TransactionBuilder(new Account(INV.publicKey(), '100'), {
      fee: BASE_FEE,
      networkPassphrase,
      timebounds: { minTime: 0, maxTime: agora() + 120 },
      ...extra,
    });
    b.addOperation(leg1());
    b.addOperation(leg2());
    return b.build().toXDR();
  }
  const ler = (x: string) => new Transaction(x, networkPassphrase);
  const recusa = (x: string) => expect(() => assertSwapXdrMatchesQuote(x, ESPERADO)).toThrow();

  it('(sanidade) cada opção entra de fato no XDR (senão os casos abaixo recusariam por outro motivo)', () => {
    expect(ler(comOpcoes({ minAccountSequence: '50' })).minAccountSequence).toBe('50');
    expect(ler(comOpcoes({ minAccountSequence: '0', minAccountSequenceAge: 86400 })).minAccountSequenceAge).toBeDefined();
    expect(ler(comOpcoes({ minAccountSequence: '0', minAccountSequenceLedgerGap: 100000 })).minAccountSequenceLedgerGap).toBe(100000);
    expect(ler(comOpcoes({ ledgerbounds: { minLedger: 0, maxLedger: 999999999 } })).ledgerBounds?.maxLedger).toBe(999999999);
    expect(ler(comOpcoes({ extraSigners: [ATACANTE.publicKey()] })).extraSigners?.length).toBe(1);
  });
  it('recusa minAccountSequence (a tx só vale com a sequence da conta em outro valor)', () => {
    recusa(comOpcoes({ minAccountSequence: '50' }));
  });
  it('recusa minAccountSequenceAge', () => {
    recusa(comOpcoes({ minAccountSequence: '0', minAccountSequenceAge: 86400 }));
  });
  it('recusa minAccountSequenceLedgerGap', () => {
    recusa(comOpcoes({ minAccountSequence: '0', minAccountSequenceLedgerGap: 100000 }));
  });
  it('recusa ledgerBounds', () => {
    recusa(comOpcoes({ ledgerbounds: { minLedger: 0, maxLedger: 999999999 } }));
  });
  it('recusa extraSigners (exigiria uma assinatura que a Plina não tem)', () => {
    recusa(comOpcoes({ extraSigners: [ATACANTE.publicKey()] }));
  });
});

/** N1-S1 (Argus a): o envelope não pode valer além do prazo do quote + 120 s, e o memo é o do build. */
describe('swap XDR — amarra ao quote (expiresAt e memo)', () => {
  const agora = () => Math.floor(Date.now() / 1000);
  const comPrazo = (maxTime: number, memo?: Memo) => xdrDe(tx([leg1(), leg2()], { maxTime, ...(memo ? { memo } : {}) }));

  it('recusa maxTime além de quote.expiresAt + 120 s (quote quase expirado não gera envelope com validade cheia)', () => {
    const expira = new Date((agora() + 10) * 1000);
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 170), { ...ESPERADO, quoteExpiresAt: expira })).toThrow();
  });
  it('aceita maxTime dentro de quote.expiresAt + 120 s', () => {
    const expira = new Date((agora() + 60) * 1000);
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 100), { ...ESPERADO, quoteExpiresAt: expira })).not.toThrow();
  });
  it('recusa quoteExpiresAt inválido (nunca compara frouxo)', () => {
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 100), { ...ESPERADO, quoteExpiresAt: new Date('x') })).toThrow();
  });
  it('recusa memo diferente do gerado no build e envelope sem memo quando o build gerou um', () => {
    const o = { ...ESPERADO, memoTexto: 'q:abc' };
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 100, Memo.text('q:outro')), o)).toThrow();
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 100), o)).toThrow();
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 100, Memo.text('q:abc')), o)).not.toThrow();
  });
  // Os dois parâmetros são OPCIONAIS no validador: omitidos, nada é conferido. A rota tem de passá-los sempre
  // (teste da rota na integração do Bento); aqui fica registrado o comportamento do validador.
  it('(documenta) sem quoteExpiresAt/memoTexto o validador não confere prazo do quote nem memo', () => {
    expect(() => assertSwapXdrMatchesQuote(comPrazo(agora() + 170, Memo.text('qualquer')), ESPERADO)).not.toThrow();
  });
});
