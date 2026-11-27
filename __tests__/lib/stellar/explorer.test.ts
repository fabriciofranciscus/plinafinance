import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountExplorerUrl, assetExplorerUrl, txExplorerUrl } from '@/lib/stellar/explorer';

afterEach(() => vi.unstubAllEnvs());

describe('links do explorer', () => {
  it('sem rede configurada: testnet (default seguro)', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', '');
    vi.stubEnv('STELLAR_NETWORK', '');
    expect(txExplorerUrl('abc')).toBe('https://stellar.expert/explorer/testnet/tx/abc');
    expect(accountExplorerUrl('G1')).toBe('https://stellar.expert/explorer/testnet/account/G1');
    expect(assetExplorerUrl('G1')).toBe('https://stellar.expert/explorer/testnet/asset/PLINARF-G1');
  });

  it('PUBLIC (cliente, via NEXT_PUBLIC): links da rede pública', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'PUBLIC');
    expect(txExplorerUrl('abc')).toBe('https://stellar.expert/explorer/public/tx/abc');
    expect(accountExplorerUrl('G1')).toBe('https://stellar.expert/explorer/public/account/G1');
    expect(assetExplorerUrl('G1', 'X')).toBe('https://stellar.expert/explorer/public/asset/X-G1');
  });

  it('PUBLIC (servidor, via STELLAR_NETWORK)', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', '');
    vi.stubEnv('STELLAR_NETWORK', 'PUBLIC');
    expect(txExplorerUrl('abc')).toBe('https://stellar.expert/explorer/public/tx/abc');
  });

  it('valor desconhecido cai em testnet, como a passphrase em config.ts', () => {
    vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'FUTURENET');
    expect(txExplorerUrl('abc')).toContain('/explorer/testnet/');
  });
});

describe('sem links fixos de testnet fora do helper', () => {
  it('nenhum arquivo de produção em app/, lib/ e components/ hardcoda o explorer', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(
      'grep',
      ['-rlE', 'stellar\\.expert/explorer/(testnet|public)', 'app', 'lib', 'components', '--include=*.ts', '--include=*.tsx', '--exclude-dir=__tests__'],
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    expect(out).toEqual(['lib/stellar/explorer.ts']);
  });
});
