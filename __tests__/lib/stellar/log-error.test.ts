import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logStellarError } from '@/lib/stellar/log-error';

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

function logged(): string {
  return consoleSpy.mock.calls.map((c: unknown[]) => JSON.stringify(c)).join('|');
}

describe('logStellarError — F-20', () => {
  it('inclui result_codes', () => {
    const err = {
      message: 'tx_failed',
      response: {
        data: {
          status: 400,
          title: 'Transaction Failed',
          extras: {
            result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] },
            result_xdr: 'AAAA...VAZAVA',
            envelope_xdr: 'AAAA...ENVVAZ',
          },
        },
      },
    };
    logStellarError('[swap]', err);
    const out = logged();
    expect(out).toContain('result_codes');
    expect(out).toContain('op_underfunded');
  });

  it('NÃO inclui result_xdr nem envelope_xdr nem result_meta_xdr', () => {
    const err = {
      message: 'tx_failed',
      response: {
        data: {
          extras: {
            result_codes: { transaction: 'tx_bad_seq' },
            result_xdr: 'AAAA...SECRETO',
            envelope_xdr: 'BBBB...SECRETO',
            result_meta_xdr: 'CCCC...SECRETO',
          },
        },
      },
    };
    logStellarError('[audit]', err);
    const out = logged();
    expect(out).not.toContain('result_xdr');
    expect(out).not.toContain('envelope_xdr');
    expect(out).not.toContain('result_meta_xdr');
    expect(out).not.toContain('SECRETO');
  });

  it('aceita erro plain (string)', () => {
    logStellarError('[issuer]', 'kaboom');
    expect(logged()).toContain('kaboom');
  });

  it('aceita null/undefined sem crashar', () => {
    logStellarError('[issuer]', null);
    logStellarError('[issuer]', undefined);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });
});
