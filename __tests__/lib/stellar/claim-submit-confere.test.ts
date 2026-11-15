import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import {
  ativoDoClaimableBalance,
  claimConfirmadoNaTx,
  conferirEnvelopeClaim,
} from '@/lib/stellar/claim';

/**
 * Conferência do XDR do claim no SUBMIT (fix/claim-submit-verify-xdr; Atlas + Argus, 15/11).
 * O submit só aceita o envelope que o build monta: source = investidor e ops =
 * [changeTrust(ativo do CB, limite máximo)?, claimClaimableBalance(balanceId da ordem)], nada mais.
 */
const INV = Keypair.random().publicKey();
const OUTRO = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const TESOURO = new Asset('TESOURO', ISSUER);
const OUTRO_ATIVO = new Asset('FAKE', ISSUER);
const BAL = '00000000435bad8e7b4606cfc6615f51f6b4595a98b526137252f5e180be42907c72e368';
const BAL_OUTRO = '000000005364e21565025f8c503f420c148228b28a189c1b67e076e495bc8462ee0176c9';

function envelope(ops: ReturnType<typeof Operation.claimClaimableBalance>[], source = INV): string {
  const b = new TransactionBuilder(new Account(source, '100'), { fee: '100', networkPassphrase });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(120).build().toXDR();
}
const claim = (balanceId = BAL, source?: string) => Operation.claimClaimableBalance({ balanceId, source });
const trust = (asset: Asset = TESOURO, limit?: string, source?: string) =>
  Operation.changeTrust({ asset, limit, source });

describe('conferirEnvelopeClaim (pura)', () => {
  const alvo = { investorPubkey: INV, balanceId: BAL };

  it('só o claim do CB da ordem → confere, sem trustline', () => {
    expect(conferirEnvelopeClaim(envelope([claim()]), alvo)).toEqual({ trustAsset: null });
  });

  it('changeTrust (limite máximo) + claim → confere e devolve o ativo da trustline', () => {
    const r = conferirEnvelopeClaim(envelope([trust(), claim()]), alvo);
    expect(r).not.toBeNull();
    expect(r!.trustAsset!.equals(TESOURO)).toBe(true);
  });

  it('source de outra conta → não confere', () => {
    expect(conferirEnvelopeClaim(envelope([claim()], OUTRO), alvo)).toBeNull();
  });

  it('claim de outro balanceId → não confere', () => {
    expect(conferirEnvelopeClaim(envelope([claim(BAL_OUTRO)]), alvo)).toBeNull();
  });

  it('op extra (payment) → não confere', () => {
    const pay = Operation.payment({ destination: OUTRO, asset: Asset.native(), amount: '1' });
    expect(conferirEnvelopeClaim(envelope([trust(), claim(), pay as never]), alvo)).toBeNull();
    expect(conferirEnvelopeClaim(envelope([pay as never, claim()]), alvo)).toBeNull();
    expect(conferirEnvelopeClaim(envelope([pay as never]), alvo)).toBeNull();
  });

  it('ordem invertida (claim antes do changeTrust) → não confere', () => {
    expect(conferirEnvelopeClaim(envelope([claim(), trust() as never]), alvo)).toBeNull();
  });

  it('changeTrust com limite diferente do máximo (inclui 0 = remover) → não confere', () => {
    expect(conferirEnvelopeClaim(envelope([trust(TESOURO, '1000'), claim()]), alvo)).toBeNull();
    expect(conferirEnvelopeClaim(envelope([trust(TESOURO, '0'), claim()]), alvo)).toBeNull();
  });

  it('op com source explícita de outra conta → não confere', () => {
    expect(conferirEnvelopeClaim(envelope([claim(BAL, OUTRO)]), alvo)).toBeNull();
    expect(conferirEnvelopeClaim(envelope([trust(TESOURO, undefined, OUTRO), claim()]), alvo)).toBeNull();
  });

  it('op com source explícita = investidor → confere', () => {
    expect(conferirEnvelopeClaim(envelope([claim(BAL, INV)]), alvo)).toEqual({ trustAsset: null });
  });

  it('XDR ilegível → não confere (não lança)', () => {
    expect(conferirEnvelopeClaim('AAAA', alvo)).toBeNull();
    expect(conferirEnvelopeClaim('não é xdr', alvo)).toBeNull();
  });

  it('fee bump → não confere', () => {
    const inner = new Transaction(envelope([claim()]), networkPassphrase);
    const fb: FeeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      Keypair.random(),
      '200',
      inner,
      networkPassphrase,
    );
    expect(conferirEnvelopeClaim(fb.toXDR(), alvo)).toBeNull();
  });

  it('outro ativo na trustline: a pura devolve o ativo (quem chama compara com o do CB)', () => {
    const r = conferirEnvelopeClaim(envelope([trust(OUTRO_ATIVO), claim()]), alvo);
    expect(r!.trustAsset!.equals(OUTRO_ATIVO)).toBe(true);
  });
});

function erroHttp(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

describe('ativoDoClaimableBalance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lê o ativo do CB no Horizon', async () => {
    const call = vi.fn().mockResolvedValue({ asset: `TESOURO:${ISSUER}` });
    const claimableBalance = vi.fn().mockReturnValue({ call });
    vi.spyOn(horizon, 'claimableBalances').mockReturnValue({ claimableBalance } as never);
    const a = await ativoDoClaimableBalance(BAL);
    expect(claimableBalance).toHaveBeenCalledWith(BAL);
    expect(a!.equals(TESOURO)).toBe(true);
  });

  it('404 → null (CB já resgatado ou inexistente)', async () => {
    const call = vi.fn().mockRejectedValue(erroHttp(404));
    vi.spyOn(horizon, 'claimableBalances').mockReturnValue({ claimableBalance: () => ({ call }) } as never);
    expect(await ativoDoClaimableBalance(BAL)).toBeNull();
  });

  it('outro erro do Horizon propaga', async () => {
    const call = vi.fn().mockRejectedValue(erroHttp(503));
    vi.spyOn(horizon, 'claimableBalances').mockReturnValue({ claimableBalance: () => ({ call }) } as never);
    await expect(ativoDoClaimableBalance(BAL)).rejects.toThrow();
  });
});

describe('claimConfirmadoNaTx (efeitos da tx no ledger)', () => {
  let records: Array<Record<string, string>>;
  let falha: Error | null;
  const forTransaction = vi.fn();

  beforeEach(() => {
    records = [];
    falha = null;
    forTransaction.mockReset().mockImplementation(() => ({
      limit: () => ({
        call: () => (falha ? Promise.reject(falha) : Promise.resolve({ records })),
      }),
    }));
    vi.spyOn(horizon, 'effects').mockReturnValue({ forTransaction } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const efeito = (over: Record<string, string> = {}) => ({
    type: 'claimable_balance_claimed',
    account: INV,
    balance_id: BAL,
    asset: `TESOURO:${ISSUER}`,
    amount: '100.0000000',
    ...over,
  });

  it('efeito claimable_balance_claimed do investidor para o CB da ordem → ativo', async () => {
    records = [{ type: 'trustline_created', account: INV }, efeito()];
    const a = await claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL });
    expect(forTransaction).toHaveBeenCalledWith('h1');
    expect(a!.equals(TESOURO)).toBe(true);
  });

  it('claim de outro CB → null', async () => {
    records = [efeito({ balance_id: BAL_OUTRO })];
    expect(await claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL })).toBeNull();
  });

  it('claim feito por outra conta → null', async () => {
    records = [efeito({ account: OUTRO })];
    expect(await claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL })).toBeNull();
  });

  it('tx sem efeito de claim → null', async () => {
    records = [{ type: 'account_debited', account: INV }];
    expect(await claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL })).toBeNull();
  });

  it('404 → null; outro erro propaga', async () => {
    falha = erroHttp(404);
    expect(await claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL })).toBeNull();
    falha = erroHttp(500);
    await expect(claimConfirmadoNaTx('h1', { investorPubkey: INV, balanceId: BAL })).rejects.toThrow();
  });
});
