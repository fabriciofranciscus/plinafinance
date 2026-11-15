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
/** Claim criado antes das txs simuladas (created_at 2026-11-11T15:00Z). */
const DESDE_CLAIM = new Date('2026-11-11T14:00:00Z');

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


/** QA Vera — I1 (962854d): bordas do semEspera na âncora REAL (Horizon/issuer simulados). */
const DESDE = new Date('2026-11-11T14:00:00Z');
const recente = new Date().toISOString();
const entrada = (over: Record<string, unknown> = {}) => ({ sha256Hex: SHA, contexto: 'COTA_INCORPORADA' as const, desde: DESDE, ...over });

describe('QA — semEspera na âncora real', () => {
  it('âncora JÁ existente no histórico: reutiliza SEM enviar nada (com e sem semEspera) — o caminho do "reencontra pelo hash" da retomada', async () => {
    paginas = [[txRec('hexistente', { created_at: '2026-11-11T15:00:00Z' })]];
    for (const semEspera of [true, false]) {
      const r = await ancorarSha256(entrada({ semEspera }) as never);
      expect(r).toMatchObject({ txHash: 'hexistente', reutilizada: true });
    }
    expect(submitEnvelope).not.toHaveBeenCalled();
  });

  it('envio com SUCESSO imediato: semEspera não muda nada (1 envio, confirmada)', async () => {
    submitEnvelope.mockImplementation(async (xdr: string) => ({ status: 'SUCCESS', hash: new Transaction(xdr, networkPassphrase).hash().toString('hex') }));
    buscarTxPorHash.mockResolvedValue({ found: true, successful: true, ledgerCloseTime: 'T' });
    const r = await ancorarSha256(entrada({ semEspera: true }) as never);
    expect(r.reutilizada).toBe(false);
    expect(submitEnvelope).toHaveBeenCalledTimes(1);
  });

  it('FAILED definitivo: ANCORA_FALHOU (não vira NAO_CONFIRMADA) com e sem semEspera', async () => {
    submitEnvelope.mockResolvedValue({ status: 'FAILED', hash: 'h', resultCodes: { transaction: 'tx_bad_seq' } });
    for (const semEspera of [true, false]) {
      const err = await ancorarSha256(entrada({ semEspera }) as never).catch((e: unknown) => e);
      expect((err as AncoraError).code).toBe('ANCORA_FALHOU');
    }
  });

  it('REGRESSÃO: SEM semEspera um envio ambíguo ainda ESPERA (dorme e consulta) — o comportamento dos outros chamadores (snapshot, DS3, Pix) não mudou', async () => {
    submitEnvelope.mockResolvedValue({ status: 'AMBIGUOUS', hash: 'h', reason: 'rede' });
    const dorme = vi.fn(async (ms: number) => { agora += ms; });
    _setRelogioAncoraForTests({ agora: () => agora, dormir: dorme });
    const err = await ancorarSha256(entrada() as never).catch((e: unknown) => e);
    expect((err as AncoraError).code).toBe('ANCORA_NAO_CONFIRMADA');
    expect(dorme).toHaveBeenCalled();
  });

  it('semEspera:false explícito também espera; só `true` corta a espera', async () => {
    submitEnvelope.mockResolvedValue({ status: 'AMBIGUOUS', hash: 'h', reason: 'rede' });
    const dorme = vi.fn(async (ms: number) => { agora += ms; });
    _setRelogioAncoraForTests({ agora: () => agora, dormir: dorme });
    await ancorarSha256(entrada({ semEspera: false }) as never).catch(() => undefined);
    expect(dorme).toHaveBeenCalled();
  });

  it('o erro da âncora ambígua carrega o txHash do envelope enviado (rastreável) e a mensagem fixa, sem dado interno', async () => {
    submitEnvelope.mockResolvedValue({ status: 'AMBIGUOUS', hash: 'h', reason: 'socket hang up https://interno.test' });
    const err = (await ancorarSha256(entrada({ semEspera: true }) as never).catch((e: unknown) => e)) as AncoraError;
    expect(err.code).toBe('ANCORA_NAO_CONFIRMADA');
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(err.message).not.toContain('interno.test');
  });

  it('RESIDUAL documentado: ambígua que ENTRA tarde + reenvio por outra chamada ⇒ 2 âncoras do mesmo hash ⇒ a busca seguinte dá ANCORA_DUPLICADA (fail-closed, nunca emissão dupla)', async () => {
    paginas = [[txRec('h1', { created_at: recente }), txRec('h2', { created_at: recente })]];
    const err = await ancorarSha256(entrada({ desde: new Date(Date.now() - 60_000), semEspera: true }) as never).catch((e: unknown) => e);
    expect((err as AncoraError).code).toBe('ANCORA_DUPLICADA');
    expect(submitEnvelope).not.toHaveBeenCalled();
  });
});
