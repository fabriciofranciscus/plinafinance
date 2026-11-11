import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Account, Keypair, Transaction } from '@stellar/stellar-sdk';

const { distKp, submitEnvelope, buscarTxPorHash } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Keypair: K } = require('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
  return { distKp: K.random(), submitEnvelope: vi.fn(), buscarTxPorHash: vi.fn() };
});

vi.mock('@/lib/stellar/signer', () => ({
  distributorSigner: () => ({
    publicKey: () => distKp.publicKey(),
    sign: (tx: Transaction) => tx.sign(distKp),
    signatureBase64: () => '',
  }),
}));
vi.mock('@/lib/stellar/issuer', () => ({ submitEnvelope, buscarTxPorHash }));

import { horizon } from '@/lib/stellar/account';
import { networkPassphrase } from '@/lib/stellar/config';
import { _resetFeeCacheForTests } from '@/lib/stellar/fee';
import {
  AncoraError,
  _setRelogioAncoraForTests,
  ancorarSha256,
  buscarAncora,
  verificarAncora,
} from '@/lib/stellar/ancora';

/** Contrato: contratos/2026-11-11-ancora-sha256-distributor.md. */
const SHA = createHash('sha256').update('snapshot-2026-11-11.json').digest('hex');
const B64 = Buffer.from(SHA, 'hex').toString('base64');
const DIST = distKp.publicKey();

const txRec = (hash: string, over: Record<string, unknown> = {}) => ({
  hash, successful: true, source_account: DIST, memo_type: 'hash', memo: B64, created_at: '2026-11-11T15:00:00Z', ...over,
});

let paginas: unknown[][] = [[]];
let paginasLidas = 0;
let agora = 0;
const lookup = vi.fn();

beforeEach(() => {
  _resetFeeCacheForTests();
  agora = Date.now();
  _setRelogioAncoraForTests({ agora: () => agora, dormir: async (ms) => { agora += ms; } });
  paginas = [[]];
  paginasLidas = 0;
  submitEnvelope.mockReset();
  buscarTxPorHash.mockReset().mockResolvedValue({ found: false });
  lookup.mockReset();
  vi.spyOn(horizon, 'feeStats').mockResolvedValue({ fee_charged: { p70: '100' } } as never);
  vi.spyOn(horizon, 'loadAccount').mockResolvedValue(new Account(DIST, '5') as never);
  vi.spyOn(horizon, 'transactions').mockImplementation(() => {
    const pagina = (i: number): unknown => {
      paginasLidas = Math.max(paginasLidas, i + 1);
      return { records: paginas[i] ?? [], next: async () => pagina(i + 1) };
    };
    const b = {
      forAccount: () => b, order: () => b, limit: () => b,
      call: async () => pagina(0),
      transaction: (h: string) => ({ call: () => lookup(h) }),
    };
    return b as never;
  });
});
afterEach(() => _setRelogioAncoraForTests());

describe('ancorarSha256', () => {
  it('monta self-payment do distributor com Memo.hash = sha256 e confirma', async () => {
    let enviado = '';
    submitEnvelope.mockImplementation(async (xdr: string) => {
      enviado = xdr;
      return { status: 'SUCCESS', hash: new Transaction(xdr, networkPassphrase).hash().toString('hex') };
    });
    buscarTxPorHash.mockResolvedValue({ found: true, successful: true, ledgerCloseTime: 'T' });

    const r = await ancorarSha256({ sha256Hex: SHA, contexto: 'SNAPSHOT_NAV' });

    const tx = new Transaction(enviado, networkPassphrase);
    const [op] = tx.operations as Array<{ type: string; destination: string; amount: string }>;
    expect(tx.source).toBe(DIST);
    expect(op.destination).toBe(DIST);
    expect(op.amount).toBe('0.0000001');
    expect(Buffer.from(tx.memo.value as Buffer).toString('hex')).toBe(SHA);
    expect(r).toEqual({ txHash: tx.hash().toString('hex'), reutilizada: false, ledgerCloseTime: 'T' });
  });

  it('idempotente: hash já ancorado → reutiliza, não submete', async () => {
    paginas = [[txRec('outra', { memo_type: 'none', memo: undefined })], [txRec('ja-ancorada')]];
    const r = await ancorarSha256({ sha256Hex: SHA, contexto: 'DOCUSIGN_PDF' });
    expect(r).toEqual({ txHash: 'ja-ancorada', reutilizada: true, ledgerCloseTime: '2026-11-11T15:00:00Z' });
    expect(submitEnvelope).not.toHaveBeenCalled();
  });

  it('ambíguo e a tx entra depois → uma âncora só (mesmo envelope)', async () => {
    const enviados: string[] = [];
    submitEnvelope.mockImplementation(async (xdr: string) => {
      enviados.push(xdr);
      return { status: 'AMBIGUOUS', hash: 'h', reason: 'http_504' };
    });
    let n = 0;
    buscarTxPorHash.mockImplementation(async () => (++n >= 3 ? { found: true, successful: true, ledgerCloseTime: 'T' } : { found: false }));

    const r = await ancorarSha256({ sha256Hex: SHA, contexto: 'SNAPSHOT_NAV' });
    expect(r.reutilizada).toBe(false);
    expect(new Set(enviados).size).toBe(1);
  });

  it('ambíguo e nunca entra → ANCORA_NAO_CONFIRMADA depois do prazo', async () => {
    submitEnvelope.mockResolvedValue({ status: 'AMBIGUOUS', hash: 'h', reason: 'rede' });
    const err = await ancorarSha256({ sha256Hex: SHA, contexto: 'SNAPSHOT_NAV' }).catch((e: unknown) => e);
    expect((err as AncoraError).code).toBe('ANCORA_NAO_CONFIRMADA');
  });

  it('definitivo → ANCORA_FALHOU na hora', async () => {
    submitEnvelope.mockResolvedValue({ status: 'FAILED', hash: 'h', resultCodes: { transaction: 'tx_insufficient_fee' } });
    const err = await ancorarSha256({ sha256Hex: SHA, contexto: 'SNAPSHOT_NAV' }).catch((e: unknown) => e);
    expect((err as AncoraError).code).toBe('ANCORA_FALHOU');
    expect(submitEnvelope).toHaveBeenCalledTimes(1);
  });

  it('hash inválido: recusa antes da rede', async () => {
    for (const h of ['ABC', SHA.toUpperCase(), SHA.slice(1), '']) {
      const err = await ancorarSha256({ sha256Hex: h, contexto: 'SNAPSHOT_NAV' }).catch((e: unknown) => e);
      expect((err as AncoraError).code).toBe('ANCORA_HASH_INVALIDO');
    }
    expect(horizon.transactions).not.toHaveBeenCalled();
  });
});

describe('buscarAncora', () => {
  it('ignora tx com o memo vinda de outra conta ou que falhou', async () => {
    paginas = [[txRec('a', { source_account: Keypair.random().publicKey() }), txRec('b', { successful: false })]];
    expect(await buscarAncora(SHA)).toBeNull();
  });

  it('duas âncoras com o mesmo hash → ANCORA_DUPLICADA', async () => {
    paginas = [[txRec('a'), txRec('b')]];
    expect(((await buscarAncora(SHA).catch((e: unknown) => e)) as AncoraError).code).toBe('ANCORA_DUPLICADA');
  });

  it('histórico acima do limite → erro, não null', async () => {
    paginas = Array.from({ length: 60 }, (_, i) => [txRec(`x${i}`, { memo_type: 'none', memo: undefined })]);
    expect(((await buscarAncora(SHA).catch((e: unknown) => e)) as AncoraError).code).toBe('ANCORA_HISTORICO_EXCEDE_LIMITE');
  });
});

describe('verificarAncora', () => {
  it('confere, e aponta cada motivo de divergência', async () => {
    lookup.mockResolvedValueOnce(txRec('t'));
    expect(await verificarAncora({ txHash: 't', sha256Hex: SHA })).toEqual({ confere: true, ledgerCloseTime: '2026-11-11T15:00:00Z' });

    lookup.mockResolvedValueOnce(txRec('t', { memo: Buffer.alloc(32, 1).toString('base64') }));
    expect((await verificarAncora({ txHash: 't', sha256Hex: SHA })).motivo).toBe('MEMO_DIVERGE');

    lookup.mockResolvedValueOnce(txRec('t', { source_account: Keypair.random().publicKey() }));
    expect((await verificarAncora({ txHash: 't', sha256Hex: SHA })).motivo).toBe('FONTE_DIVERGE');

    lookup.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
    expect((await verificarAncora({ txHash: 't', sha256Hex: SHA })).motivo).toBe('NAO_ENCONTRADA');

    lookup.mockRejectedValueOnce(Object.assign(new Error('horizon 500'), { response: { status: 500 } }));
    await expect(verificarAncora({ txHash: 't', sha256Hex: SHA })).rejects.toThrow('horizon 500');
  });
});

describe('busca limitada por data (S3 do Argus)', () => {
  const DESDE = new Date('2026-11-11T15:00:00Z');
  const em = (iso: string) => ({ created_at: iso });
  // página = 200 txs sem o memo, em ordem decrescente de tempo
  const paginaSem = (iso: string) => Array.from({ length: 200 }, (_, i) => txRec(`x-${iso}-${i}`, { memo: 'outro', ...em(iso) }));

  it('para de paginar ao passar de desde − 1 h (não lê o histórico todo)', async () => {
    paginas = [paginaSem('2026-11-11T16:00:00Z'), paginaSem('2026-11-11T13:59:59Z'), ...Array.from({ length: 60 }, () => paginaSem('2026-11-10T00:00:00Z'))];
    expect(await buscarAncora(SHA, { desde: DESDE })).toBeNull();
    expect(paginasLidas).toBe(2);
  });

  it('acha a âncora dentro da janela (até 1 h antes do claim)', async () => {
    paginas = [paginaSem('2026-11-11T16:00:00Z'), [txRec('ancora', em('2026-11-11T14:30:00Z'))]];
    expect(await buscarAncora(SHA, { desde: DESDE })).toEqual({ txHash: 'ancora', ledgerCloseTime: '2026-11-11T14:30:00Z' });
  });

  it('com desde, histórico grande NÃO vira ANCORA_HISTORICO_EXCEDE_LIMITE', async () => {
    paginas = [...Array.from({ length: 60 }, () => paginaSem('2026-11-11T18:00:00Z')), paginaSem('2026-11-11T13:00:00Z')];
    expect(await buscarAncora(SHA, { desde: DESDE })).toBeNull();
  });

  it('sem desde, o teto de 10.000 txs continua (comportamento anterior)', async () => {
    paginas = Array.from({ length: 60 }, () => paginaSem('2026-11-11T18:00:00Z'));
    const err = await buscarAncora(SHA).catch((e: unknown) => e);
    expect((err as AncoraError).code).toBe('ANCORA_HISTORICO_EXCEDE_LIMITE');
  });

  it('duplicada dentro da janela continua ANCORA_DUPLICADA', async () => {
    paginas = [[txRec('a', em('2026-11-11T15:10:00Z')), txRec('b', em('2026-11-11T15:05:00Z'))], paginaSem('2026-11-11T13:00:00Z')];
    expect(((await buscarAncora(SHA, { desde: DESDE }).catch((e: unknown) => e)) as AncoraError).code).toBe('ANCORA_DUPLICADA');
  });

  it('desde inválido → erro, sem consultar', async () => {
    await expect(buscarAncora(SHA, { desde: new Date('x') })).rejects.toThrow(/desde inválido/);
    expect(paginasLidas).toBe(0);
  });

  it('ancorarSha256 repassa desde: âncora existente na janela é reutilizada', async () => {
    paginas = [[txRec('ja', em('2026-11-11T15:20:00Z'))]];
    const r = await ancorarSha256({ sha256Hex: SHA, contexto: 'SNAPSHOT_NAV', desde: DESDE });
    expect(r).toMatchObject({ txHash: 'ja', reutilizada: true });
    expect(submitEnvelope).not.toHaveBeenCalled();
  });
});
