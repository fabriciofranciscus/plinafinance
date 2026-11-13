import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Account, Keypair, type Transaction } from '@stellar/stellar-sdk';

import { horizon } from '@/lib/stellar/account';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  EmissaoPorMemoError,
  IssueAssetInputError,
  buscarEmissaoPorMemo,
  issueAsset,
} from '@/lib/stellar/issuer';
import type { StellarSigner } from '@/lib/stellar/signer';

/**
 * E1-4 parte 2 — emissão idempotente por memo. Contratos:
 * contratos/2026-11-10-e1-4-emissao-idempotente.md e o adendo
 * contratos/2026-11-10-issue-asset-memo-erros.md.
 */
const issuerKp = Keypair.random();
const ISSUER = issuerKp.publicKey();
const DESTINO = Keypair.random().publicKey();
const OUTRO = Keypair.random().publicKey();
const MEMO = createHash('sha256').update('plina:incorporacao:cessao-1').digest();
const MEMO_B64 = MEMO.toString('base64');

const signer: StellarSigner = {
  publicKey: () => ISSUER,
  sign: vi.fn((tx: Transaction) => tx.sign(issuerKp)),
  signatureBase64: () => '',
};

type TxRec = { hash: string; successful: boolean; memo_type: string; memo?: string };
type OpRec = Record<string, unknown>;

function txRec(hash: string, memo: Buffer | null = MEMO, successful = true): TxRec {
  return memo
    ? { hash, successful, memo_type: 'hash', memo: memo.toString('base64') }
    : { hash, successful, memo_type: 'none' };
}

function pagamento(over: OpRec = {}): OpRec {
  return {
    type: 'payment',
    from: ISSUER,
    to: DESTINO,
    asset_type: 'credit_alphanum12',
    asset_code: 'PLINARF',
    asset_issuer: ISSUER,
    amount: '400.0000000',
    ...over,
  };
}

/** Horizon fake: páginas de tx da conta de destino e operações por tx. */
function mockHorizon(
  paginas: TxRec[][],
  opsPorTx: Record<string, OpRec[]> = {},
  falhas: { primeira?: Error; naPagina?: number; ops?: Error } = {},
) {
  const pagina = (i: number): unknown => ({
    records: paginas[i] ?? [],
    next: async () => {
      if (falhas.naPagina === i + 1) throw new Error('horizon 504 na página');
      return pagina(i + 1);
    },
  });
  const txBuilder = {
    forAccount: vi.fn(() => txBuilder),
    order: vi.fn(() => txBuilder),
    limit: vi.fn(() => txBuilder),
    call: vi.fn(async () => {
      if (falhas.primeira) throw falhas.primeira;
      return pagina(0);
    }),
  };
  vi.spyOn(horizon, 'transactions').mockReturnValue(txBuilder as never);
  vi.spyOn(horizon, 'operations').mockImplementation(() => {
    let hash = '';
    const b = {
      forTransaction: vi.fn((h: string) => {
        hash = h;
        return b;
      }),
      limit: vi.fn(() => b),
      call: vi.fn(async () => {
        if (falhas.ops) throw falhas.ops;
        return { records: opsPorTx[hash] ?? [] };
      }),
    };
    return b as never;
  });
  return txBuilder;
}

let submetida: Transaction | undefined;

beforeEach(() => {
  _resetFeeCacheForTests();
  submetida = undefined;
  vi.stubEnv('STELLAR_ISSUER_PUBLIC', ISSUER);
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockImplementation(
    async () =>
      Object.assign(new Account(ISSUER, '10'), {
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
      }) as never,
  );
  vi.spyOn(horizon, 'submitTransaction').mockImplementation(async (tx) => {
    submetida = tx as Transaction;
    return { hash: 'h', successful: true } as never;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('issueAsset com memoHash', () => {
  it('leva Memo.hash com os 32 bytes pedidos', async () => {
    await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', { memoHash: MEMO });

    expect(submetida?.memo.type).toBe('hash');
    expect(Buffer.from(submetida!.memo.value as Buffer).equals(MEMO)).toBe(true);
  });

  it('sem opts, emissão sem memo (comportamento anterior)', async () => {
    await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF');
    expect(submetida?.memo.type).toBe('none');
  });

  it('memo inválido é recusado antes de carregar a conta ou assinar', async () => {
    const invalidos: unknown[] = [
      Buffer.alloc(31),
      Buffer.alloc(33),
      Buffer.alloc(0),
      MEMO.toString('hex'),
      null,
    ];
    for (const memoHash of invalidos) {
      const err = await issueAsset(signer, DESTINO, '400.0000000', 'PLINARF', {
        memoHash: memoHash as Buffer,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IssueAssetInputError);
      expect((err as IssueAssetInputError).code).toBe('ISSUE_MEMO_INVALID');
    }
    expect(horizon.loadAccount).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(horizon.submitTransaction).not.toHaveBeenCalled();
  });
});

describe('buscarEmissaoPorMemo', () => {
  const input = { code: 'PLINARF', destination: DESTINO, memoHash: MEMO };

  it('acha a emissão pelo memo e devolve txHash e amount', async () => {
    const tx = mockHorizon(
      [[txRec('t-sem-memo', null), txRec('t-emissao')]],
      { 't-emissao': [pagamento()] },
    );

    expect(await buscarEmissaoPorMemo(input)).toEqual({
      txHash: 't-emissao',
      amount: '400.0000000',
    });
    expect(tx.forAccount).toHaveBeenCalledWith(DESTINO);
  });

  it('acha na segunda página', async () => {
    mockHorizon([[txRec('a', null)], [txRec('t-emissao')]], {
      't-emissao': [pagamento({ amount: '376.4705882' })],
    });

    expect(await buscarEmissaoPorMemo(input)).toEqual({
      txHash: 't-emissao',
      amount: '376.4705882',
    });
  });

  it('não achou: null', async () => {
    mockHorizon([[txRec('a', null), txRec('b', Buffer.alloc(32, 7))]]);
    expect(await buscarEmissaoPorMemo(input)).toBeNull();
  });

  it('ignora tx com o memo que não é emissão do issuer para o destino naquele asset', async () => {
    mockHorizon([[txRec('de-outro'), txRec('outro-asset'), txRec('outro-destino'), txRec('falhou', MEMO, false)]], {
      'de-outro': [pagamento({ from: OUTRO })],
      'outro-asset': [pagamento({ asset_code: 'PLINARFB' })],
      'outro-destino': [pagamento({ to: OUTRO })],
      falhou: [pagamento()],
    });
    expect(await buscarEmissaoPorMemo(input)).toBeNull();
  });

  it('duas emissões com o mesmo memo: erro, não escolhe uma', async () => {
    mockHorizon([[txRec('t1'), txRec('t2')]], {
      t1: [pagamento()],
      t2: [pagamento()],
    });
    const err = await buscarEmissaoPorMemo(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmissaoPorMemoError);
    expect((err as EmissaoPorMemoError).code).toBe('EMISSAO_DUPLICADA');
  });

  it('falha do Horizon na 1ª leitura lança — nunca null', async () => {
    mockHorizon([], {}, { primeira: new Error('horizon 504') });
    await expect(buscarEmissaoPorMemo(input)).rejects.toThrow('horizon 504');
  });

  it('falha do Horizon no meio da paginação lança', async () => {
    mockHorizon([[txRec('a', null)], [txRec('b', null)]], {}, { naPagina: 1 });
    await expect(buscarEmissaoPorMemo(input)).rejects.toThrow('horizon 504');
  });

  it('falha ao ler as operações da tx candidata lança', async () => {
    mockHorizon([[txRec('t-emissao')]], {}, { ops: new Error('horizon 500 ops') });
    await expect(buscarEmissaoPorMemo(input)).rejects.toThrow('horizon 500 ops');
  });

  it('histórico acima do limite: erro, não null', async () => {
    const paginas = Array.from({ length: 60 }, (_, i) => [txRec(`x${i}`, null)]);
    mockHorizon(paginas);
    const err = await buscarEmissaoPorMemo(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmissaoPorMemoError);
    expect((err as EmissaoPorMemoError).code).toBe('HISTORICO_EXCEDE_LIMITE');
  });

  it('memo inválido ou code fora da Plina: recusa sem ir ao Horizon', async () => {
    const tx = mockHorizon([]);
    const e1 = await buscarEmissaoPorMemo({ ...input, memoHash: Buffer.alloc(16) }).catch(
      (e: unknown) => e,
    );
    expect((e1 as IssueAssetInputError).code).toBe('ISSUE_MEMO_INVALID');
    const e2 = await buscarEmissaoPorMemo({ ...input, code: 'USDC' }).catch((e: unknown) => e);
    expect((e2 as IssueAssetInputError).code).toBe('ISSUE_CODE_UNKNOWN');
    expect(tx.call).not.toHaveBeenCalled();
  });

  it('issuer ausente no ambiente: CONFIG_AUSENTE sem nome de env', async () => {
    const tx = mockHorizon([]);
    vi.stubEnv('STELLAR_ISSUER_PUBLIC', '');
    const err = await buscarEmissaoPorMemo(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmissaoPorMemoError);
    expect((err as EmissaoPorMemoError).code).toBe('CONFIG_AUSENTE');
    expect((err as Error).message).not.toMatch(/STELLAR_|_PUBLIC/);
    expect(tx.call).not.toHaveBeenCalled();
  });
});

// Garante que o memo do teste é o que o Bento vai gerar (sha256 → 32 bytes).
it('memo de referência tem 32 bytes', () => {
  expect(MEMO).toHaveLength(32);
  expect(MEMO_B64).toHaveLength(44);
});
