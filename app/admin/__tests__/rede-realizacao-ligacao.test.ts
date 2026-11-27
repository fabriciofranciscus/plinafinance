import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A tela libera o Caminho A pela mesma regra do servidor (#166): rede da configuração exatamente TESTNET; ausente = TESTNET.
const pagina = readFileSync('app/admin/page.tsx', 'utf8');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('/admin: liberação do Caminho A', () => {
  it('a página passa a regra a partir de lib/stellar/config, não de process.env', () => {
    expect(pagina).toMatch(/import \{[^}]*\bSTELLAR_NETWORK\b[^}]*\} from '@\/lib\/stellar\/config';/);
    const usos = pagina.split(/<CompradorPipeline\b/).slice(1);
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) expect(uso.slice(0, uso.indexOf('/>'))).toContain("realizacaoLiberada={STELLAR_NETWORK === 'TESTNET'}");
  });

  it.each([
    [undefined, true],
    ['TESTNET', true],
    ['PUBLIC', false],
    ['testnet', false],
    [' TESTNET', false],
    ['', false],
  ])('STELLAR_NETWORK=%j: a configuração libera=%s', async (valor, libera) => {
    vi.stubEnv('STELLAR_NETWORK', valor);
    vi.resetModules();
    const { STELLAR_NETWORK } = await import('@/lib/stellar/config');
    expect(STELLAR_NETWORK === 'TESTNET').toBe(libera);
  });
});
