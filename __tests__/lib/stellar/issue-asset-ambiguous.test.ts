import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Account, Keypair, Transaction } from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  EmissaoError,
  IssueAssetInputError,
  _setRelogioForTests,
  buildIssueAssetTx,
  buscarTxPorHash,
  issueAsset,
  submitEnvelope,
} from '@/lib/stellar/issuer';
import type { StellarSigner } from '@/lib/stellar/signer';

/**
 * E1-4 — erro ambíguo na emissão. Contratos:
 * contratos/2026-11-10-reemissao-erro-ambiguo.md (Atlas, 10:37) e
 * contratos/2026-11-10-emissao-ambigua-e-supply-erros.md (códigos).
 */
const issuerKp = Keypair.random();
const DESTINO = Keypair.random().publicKey();
const MEMO = Buffer.alloc(32, 9);

const signer: StellarSigner = {
  publicKey: () => issuerKp.publicKey(),
  sign: vi.fn((tx: Transaction) => tx.sign(issuerKp)),
  signatureBase64: () => '',
};

// Relógio falso: dormir avança o tempo, sem esperar de verdade.
let agora = 0;
const dormir = vi.fn(async (ms: number) => {
  agora += ms;
});

const erro504 = () => Object.assign(new Error('timeout'), { response: { status: 504 } });
const erroRede = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const erro400 = (codes: unknown) =>
  Object.assign(new Error('bad request'), {
    response: { status: 400, data: { extras: { result_codes: codes } } },
  });
const erro404 = () => Object.assign(new Error('not found'), { response: { status: 404 } });

function registro(hash: string, successful = true) {
  return {
    hash,
    successful,
    ledger_attr: 123,
    created_at: '2026-11-10T13:00:00Z',
    envelope_xdr: 'env',
    result_xdr: 'res',
    result_meta_xdr: 'meta',
    paging_token: 'pt',
  };
}

const lookup = vi.fn<(hash: string) => Promise<unknown>>();

beforeEach(() => {
  _resetFeeCacheForTests();
  agora = Date.now();
  _setRelogioForTests({ agora: () => agora, dormir });
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockImplementation(
    async () =>
      Object.assign(new Account(issuerKp.publicKey(), '10'), {
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
      }) as never,
  );
  lookup.mockReset().mockImplementation(async () => {
    throw erro404();
  });
  vi.spyOn(horizon, 'transactions').mockReturnValue({
    transaction: (hash: string) => ({ call: () => lookup(hash) }),
  } as never);
});

afterEach(() => {
  _setRelogioForTests();
});

/** Hash de cada envelope submetido: prova que o reenvio é o MESMO XDR. */
function hashesSubmetidos(): string[] {
  return vi
    .mocked(horizon.submitTransaction)
    .mock.calls.map(([tx]) => (tx as Transaction).hash().toString('hex'));
}

describe('issueAsset — erro ambíguo (despacho E1-4)', () => {
  it('ambíguo, e a tx entra depois → sucesso, uma emissão só', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro504());
    let chamadas = 0;
    lookup.mockImplementation(async (hash: string) => {
      chamadas += 1;
      if (chamadas < 3) throw erro404();
      return registro(hash);
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });

    const hashes = hashesSubmetidos();
    expect(new Set(hashes).size).toBe(1); // sempre o mesmo envelope
    expect(res.hash).toBe(hashes[0]);
    expect(res.successful).toBe(true);
    expect(signer.sign).toHaveBeenCalledTimes(1); // um só envelope assinado
  });

  it('ambíguo, e a tx não entra → lança só depois do maxTime + 10 s', async () => {
    const reenviosEm: number[] = [];
    vi.spyOn(horizon, 'submitTransaction').mockImplementation(async () => {
      reenviosEm.push(agora);
      throw erro504();
    });

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(EmissaoError);
    expect((err as EmissaoError).code).toBe('EMISSAO_NAO_CONFIRMADA');
    const maxTime = (err as EmissaoError).maxTime!;
    expect(agora).toBeGreaterThanOrEqual((maxTime + 10) * 1000);
    // Nenhum reenvio depois do maxTime; todos com o mesmo hash.
    expect(reenviosEm.every((t) => t < maxTime * 1000)).toBe(true);
    expect(new Set(hashesSubmetidos()).size).toBe(1);
  });

  it('definitivo (result_codes) → lança EMISSAO_FALHOU na hora', async () => {
    const codes = { transaction: 'tx_failed', operations: ['op_no_trust'] };
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro400(codes));

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(EmissaoError);
    expect((err as EmissaoError).code).toBe('EMISSAO_FALHOU');
    expect((err as EmissaoError).resultCodes).toEqual(codes);
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('ambíguo e a tx entrou com falha → EMISSAO_FALHOU, não reemite', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erroRede());
    lookup.mockImplementation(async (hash: string) => registro(hash, false));

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect((err as EmissaoError).code).toBe('EMISSAO_FALHOU');
    expect(new Set(hashesSubmetidos()).size).toBe(1);
  });

  it('reenvio dá tx_bad_seq e a tx aparece pelo hash → sucesso', async () => {
    vi.spyOn(horizon, 'submitTransaction')
      .mockRejectedValueOnce(erro504())
      .mockRejectedValue(erro400({ transaction: 'tx_bad_seq' }));
    let chamadas = 0;
    lookup.mockImplementation(async (hash: string) => {
      chamadas += 1;
      if (chamadas < 2) throw erro404();
      return registro(hash);
    });

    const res = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF');
    expect(res.successful).toBe(true);
  });

  it('se a consulta final ao Horizon falha, propaga o erro (não afirma que não entrou)', async () => {
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValue(erro504());
    lookup.mockImplementation(async () => {
      throw Object.assign(new Error('horizon 503'), { response: { status: 503 } });
    });

    const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(EmissaoError);
    expect((err as Error).message).toBe('horizon 503');
  });
});

describe('primitivas (contrato das 10:37)', () => {
  it('buildIssueAssetTx devolve envelope assinado, hash e maxTime', async () => {
    const b = await buildIssueAssetTx(signer, DESTINO, '400.0000000', 'PLINARF', {
      memoHash: MEMO,
    });
    const tx = new Transaction(b.xdr, networkPassphrase);
    expect(tx.signatures).toHaveLength(1);
    expect(b.hash).toBe(tx.hash().toString('hex'));
    expect(b.maxTime).toBe(Number(tx.timeBounds?.maxTime));
    expect(tx.memo.type).toBe('hash');
  });

  it('buildIssueAssetTx valida antes de carregar a conta ou assinar', async () => {
    const err = await buildIssueAssetTx(signer, DESTINO, '0', 'PLINARF').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(IssueAssetInputError);
    expect(horizon.loadAccount).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('submitEnvelope classifica sucesso, definitivo e ambíguo', async () => {
    const { xdr, hash } = await buildIssueAssetTx(signer, DESTINO, '1', 'PLINARF');
    const submit = vi.spyOn(horizon, 'submitTransaction');

    submit.mockResolvedValueOnce({ hash, successful: true } as never);
    expect(await submitEnvelope(xdr)).toMatchObject({ status: 'SUCCESS', hash });

    submit.mockRejectedValueOnce(erro400({ transaction: 'tx_insufficient_balance' }));
    expect(await submitEnvelope(xdr)).toEqual({
      status: 'FAILED',
      hash,
      resultCodes: { transaction: 'tx_insufficient_balance' },
    });

    for (const e of [erro504(), erroRede(), Object.assign(new Error('x'), { response: { status: 500 } })]) {
      submit.mockRejectedValueOnce(e);
      expect(await submitEnvelope(xdr)).toMatchObject({ status: 'AMBIGUOUS', hash });
    }
  });

  it('submitEnvelope: tx_bad_seq sem a tx no ledger vira AMBIGUOUS (pode estar entrando)', async () => {
    const { xdr, hash } = await buildIssueAssetTx(signer, DESTINO, '1', 'PLINARF');
    vi.spyOn(horizon, 'submitTransaction').mockRejectedValueOnce(
      erro400({ transaction: 'tx_bad_seq' }),
    );
    expect(await submitEnvelope(xdr)).toMatchObject({ status: 'AMBIGUOUS', hash });
  });

  it('buscarTxPorHash: achou, não achou (404) e erro propaga', async () => {
    lookup.mockResolvedValueOnce(registro('h1'));
    expect(await buscarTxPorHash('h1')).toEqual({
      found: true,
      successful: true,
      ledgerCloseTime: '2026-11-10T13:00:00Z',
    });

    lookup.mockRejectedValueOnce(erro404());
    expect(await buscarTxPorHash('h2')).toEqual({ found: false });

    lookup.mockRejectedValueOnce(Object.assign(new Error('horizon 500'), { response: { status: 500 } }));
    await expect(buscarTxPorHash('h3')).rejects.toThrow('horizon 500');
  });
});
