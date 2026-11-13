import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TimeoutInfinite,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import { buildClaimClaimableBalanceXdr } from '@/lib/stellar/transactions';
import {
  ClaimError,
  aporteNecessarioXlm,
  buildAporteReservaXdr,
  prepararClaimXdr,
  xdrExpirado,
} from '@/lib/stellar/claim';

/**
 * Execução de referência: `scripts/smoke-investidor.ts` em 2026-09-28,
 * tx 50a2f198…a311 no testnet. O XDR do anchor tinha, nesta ordem:
 *   change_trust(TESOURO:GC3C…UPS4, limit 922337203685.4775807)
 *   claim_claimable_balance(00000000435b…e368)
 * com source = carteira do investidor.
 */
const REF = {
  investor: 'GCVYILBY4B4MSLY7G3FAVI74NJTLG4ZON7LTFC2TU2Z7OXOQLLG4AJTC',
  balanceId:
    '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368',
  assetCode: 'TESOURO',
  assetIssuer: 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
  amount: '344.0186920',
  limitMax: '922337203685.4775807',
};
const OUTRO = Keypair.random().publicKey();
const FUNDER = Keypair.random().publicKey();

type Bal = { asset_type: string; balance: string; [campo: string]: string };

function conta(
  pubkey: string,
  over: {
    seq?: string;
    balances?: Bal[];
    subentry_count?: number;
    num_sponsoring?: number;
    num_sponsored?: number;
  } = {},
) {
  const acc = new Account(pubkey, over.seq ?? '1000');
  return Object.assign(acc, {
    balances: over.balances ?? [
      { asset_type: 'native', balance: '2.0000000', selling_liabilities: '0.0000000' },
    ],
    subentry_count: over.subentry_count ?? 0,
    num_sponsoring: over.num_sponsoring ?? 0,
    num_sponsored: over.num_sponsored ?? 0,
  });
}

function cbRecord(over: Partial<{ asset: string; claimants: { destination: string }[] }> = {}) {
  return {
    id: REF.balanceId,
    asset: `${REF.assetCode}:${REF.assetIssuer}`,
    amount: REF.amount,
    claimants: [{ destination: REF.investor, predicate: { unconditional: true } }],
    ...over,
  };
}

let contaAtual: ReturnType<typeof conta>;
let cbAtual: ReturnType<typeof cbRecord> | 'NOT_FOUND';

beforeEach(() => {
  _resetFeeCacheForTests();
  contaAtual = conta(REF.investor);
  cbAtual = cbRecord();
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({
    fee_charged: { p70: '100' },
  } as never);
  // Cada build recarrega a conta: devolve um clone para não acumular sequência.
  vi.spyOn(horizon, 'loadAccount').mockImplementation(async () =>
    conta(contaAtual.accountId(), {
      seq: contaAtual.sequenceNumber(),
      balances: contaAtual.balances,
      subentry_count: contaAtual.subentry_count,
      num_sponsoring: contaAtual.num_sponsoring,
      num_sponsored: contaAtual.num_sponsored,
    }) as never,
  );
  vi.spyOn(horizon, 'claimableBalances').mockReturnValue({
    claimableBalance: () => ({
      call: async () => {
        if (cbAtual === 'NOT_FOUND') {
          throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
        }
        return cbAtual;
      },
    }),
  } as never);
});

function ops(xdr: string) {
  return new Transaction(xdr, networkPassphrase).operations as unknown as Array<
    Record<string, unknown> & { type: string }
  >;
}

describe('prepararClaimXdr — reproduz a execução de referência', () => {
  it('carteira só com XLM: changeTrust + claim no mesmo XDR, nesta ordem', async () => {
    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    });

    const tx = new Transaction(r.xdr, networkPassphrase);
    expect(tx.source).toBe(REF.investor);
    const [trust, claim] = ops(r.xdr);
    expect(ops(r.xdr)).toHaveLength(2);
    expect(trust.type).toBe('changeTrust');
    const line = trust.line as Asset;
    expect(line.getCode()).toBe(REF.assetCode);
    expect(line.getIssuer()).toBe(REF.assetIssuer);
    expect(trust.limit).toBe(REF.limitMax);
    expect(claim.type).toBe('claimClaimableBalance');
    expect(claim.balanceId).toBe(REF.balanceId);

    expect(r.operacoes).toEqual(['changeTrust', 'claimClaimableBalance']);
    expect(r.asset).toBe(`${REF.assetCode}:${REF.assetIssuer}`);
    expect(r.amount).toBe(REF.amount);
    expect(r.hashHex).toBe('0x' + tx.hash().toString('hex'));
    // Diferença deliberada da referência: o nosso XDR expira.
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(0);
  });

  it('trustline já existe: só o claim', async () => {
    contaAtual = conta(REF.investor, {
      balances: [
        { asset_type: 'native', balance: '2.0000000', selling_liabilities: '0' },
        {
          asset_type: 'credit_alphanum12',
          asset_code: REF.assetCode,
          asset_issuer: REF.assetIssuer,
          balance: '0.0000000',
        },
      ],
      subentry_count: 1,
    });

    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    });

    expect(r.operacoes).toEqual(['claimClaimableBalance']);
    expect(ops(r.xdr)).toHaveLength(1);
  });

  it('recusa quando o investidor não é claimant do CB', async () => {
    cbAtual = cbRecord({ claimants: [{ destination: OUTRO }] });

    const err = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaimError);
    expect((err as ClaimError).code).toBe('NOT_CLAIMANT');
  });

  it('CB inexistente vira erro tipado (caller reconcilia pelo hash)', async () => {
    cbAtual = 'NOT_FOUND';

    const err = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaimError);
    expect((err as ClaimError).code).toBe('CB_NOT_FOUND');
  });

  it('sem reserva para a trustline: recusa e informa o aporte exato', async () => {
    // (2 + 0 subentries + 1 trustline nova) × 0,5 = 1,5 XLM + 0,02 de fee
    contaAtual = conta(REF.investor, {
      balances: [{ asset_type: 'native', balance: '1.0000000', selling_liabilities: '0' }],
    });

    const err = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaimError);
    expect((err as ClaimError).code).toBe('RESERVA_INSUFICIENTE');
    expect((err as ClaimError).aporteXlm).toBe('0.5200000');
  });
});

describe('prepararClaimXdr — XDR expirado ou com sequência velha', () => {
  it('reaproveita o XDR anterior quando ainda vale', async () => {
    const primeiro = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    });

    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
      xdrAnterior: primeiro.xdr,
    });

    expect(r.regenerado).toBe(false);
    expect(r.xdr).toBe(primeiro.xdr);
  });

  it('regenera quando o XDR anterior expirou', async () => {
    const primeiro = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    });
    const maxTime = Number(new Transaction(primeiro.xdr, networkPassphrase).timeBounds?.maxTime);
    vi.spyOn(Date, 'now').mockReturnValue((maxTime + 1) * 1000);

    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
      xdrAnterior: primeiro.xdr,
    });

    expect(r.regenerado).toBe(true);
    expect(r.xdr).not.toBe(primeiro.xdr);
    expect(xdrExpirado(r.xdr)).toBe(false);
  });

  it('regenera quando a sequência da conta andou', async () => {
    const primeiro = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
    });
    contaAtual = conta(REF.investor, { seq: '1001' });

    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
      xdrAnterior: primeiro.xdr,
    });

    expect(r.regenerado).toBe(true);
    expect(new Transaction(r.xdr, networkPassphrase).sequence).toBe('1002');
  });

  it('não reaproveita XDR anterior de outro claimable balance', async () => {
    const outroCb = await buildClaimClaimableBalanceXdr({
      investorPubkey: REF.investor,
      balanceId:
        '00000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    const r = await prepararClaimXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
      xdrAnterior: outroCb.xdr,
    });

    expect(r.regenerado).toBe(true);
    expect(ops(r.xdr).at(-1)?.balanceId).toBe(REF.balanceId);
  });
});

describe('xdrExpirado', () => {
  function txCom(timeout: number) {
    return new TransactionBuilder(new Account(REF.investor, '1'), {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '10' }))
      .setTimeout(timeout)
      .build();
  }

  it('falso antes do maxTime, verdadeiro depois (com margem)', () => {
    const tx = txCom(120);
    const maxTime = Number(tx.timeBounds?.maxTime);
    expect(xdrExpirado(tx.toXDR(), maxTime - 60)).toBe(false);
    // Margem default: considera expirado alguns segundos antes do limite.
    expect(xdrExpirado(tx.toXDR(), maxTime - 2)).toBe(true);
    expect(xdrExpirado(tx.toXDR(), maxTime + 1)).toBe(true);
  });

  it('XDR sem limite de tempo nunca expira', () => {
    const tx = txCom(TimeoutInfinite);
    expect(xdrExpirado(tx.toXDR(), 4_000_000_000)).toBe(false);
  });
});

describe('aporte da 2ª trustline', () => {
  it('calcula a falta considerando subentries, patrocínio e liabilities', () => {
    // TESOURO já existe (1 subentry); PLINARF será a 2ª trustline.
    // mínimo = (2 + 1 + 1) × 0,5 = 2,0; + 0,02 fee = 2,02
    // disponível = 1,8 - 0,1 liabilities = 1,7 → falta 0,32
    const falta = aporteNecessarioXlm(
      conta(REF.investor, {
        balances: [
          { asset_type: 'native', balance: '1.8000000', selling_liabilities: '0.1000000' },
        ],
        subentry_count: 1,
      }),
      1,
    );
    expect(falta).toBe('0.3200000');
  });

  it('reserva patrocinada pelo anchor não conta contra o investidor', () => {
    // mínimo = (2 + 1 + 1 + 0 - 1 patrocinada) × 0,5 = 1,5 + 0,02 = 1,52
    const falta = aporteNecessarioXlm(
      conta(REF.investor, {
        balances: [{ asset_type: 'native', balance: '1.5200000', selling_liabilities: '0' }],
        subentry_count: 1,
        num_sponsored: 1,
      }),
      1,
    );
    expect(falta).toBe('0.0000000');
  });

  it('buildAporteReservaXdr: payment nativo do funder para o investidor', async () => {
    contaAtual = conta(FUNDER, { seq: '500' });

    const { xdr } = await buildAporteReservaXdr({
      funderPubkey: FUNDER,
      investorPubkey: REF.investor,
      amountXlm: '0.5200000',
    });

    const tx = new Transaction(xdr, networkPassphrase);
    expect(tx.source).toBe(FUNDER);
    const [pay] = ops(xdr);
    expect(pay.type).toBe('payment');
    expect(pay.destination).toBe(REF.investor);
    expect((pay.asset as Asset).isNative()).toBe(true);
    expect(pay.amount).toBe('0.5200000');
  });

  it('buildAporteReservaXdr recusa valor fora do teto ou não positivo', async () => {
    contaAtual = conta(FUNDER);
    for (const amountXlm of ['0', '-1', '5']) {
      const err = await buildAporteReservaXdr({
        funderPubkey: FUNDER,
        investorPubkey: REF.investor,
        amountXlm,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ClaimError);
      expect((err as ClaimError).code).toBe('APORTE_FORA_DO_TETO');
    }
  });
});

describe('buildClaimClaimableBalanceXdr com trustAsset', () => {
  it('prepende changeTrust ao claim quando trustAsset vem', async () => {
    const { xdr } = await buildClaimClaimableBalanceXdr({
      investorPubkey: REF.investor,
      balanceId: REF.balanceId,
      trustAsset: new Asset(REF.assetCode, REF.assetIssuer),
    });
    expect(ops(xdr).map((o) => o.type)).toEqual([
      'changeTrust',
      'claimClaimableBalance',
    ]);
  });
});
