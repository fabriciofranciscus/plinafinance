import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Env vazia não pode virar valor vazio (Atlas, 16/11, extensão do fix/horizon-url-vazia): `??` só cai no padrão com
 * undefined. Ex.: ASSET_CODE='' virava código vazio. O FUNDER_DAILY_CAP saiu desta tabela: ele é obrigatório e
 * fail-closed, sem padrão (decisão do Atlas; funder-cap-obrigatorio.test.ts).
 */
type Nome = 'ASSET_CODE' | 'FUNDER_BALANCE_FLOOR' | 'ISSUER_BALANCE_FLOOR' | 'DISTRIBUTOR_BALANCE_FLOOR';
const EXPORT: Record<Nome, string> = {
  ASSET_CODE: 'assetCode',
  FUNDER_BALANCE_FLOOR: 'FUNDER_BALANCE_FLOOR',
  ISSUER_BALANCE_FLOOR: 'ISSUER_BALANCE_FLOOR',
  DISTRIBUTOR_BALANCE_FLOOR: 'DISTRIBUTOR_BALANCE_FLOOR',
};
const PADRAO: Record<Nome, unknown> = {
  ASSET_CODE: 'PLINARF',
  FUNDER_BALANCE_FLOOR: '50',
  ISSUER_BALANCE_FLOOR: '5',
  DISTRIBUTOR_BALANCE_FLOOR: '5',
};
const PREENCHIDO: Record<Nome, [string, unknown]> = {
  ASSET_CODE: [' PLINAX ', 'PLINAX'],
  FUNDER_BALANCE_FLOOR: [' 80 ', '80'],
  ISSUER_BALANCE_FLOOR: [' 9 ', '9'],
  DISTRIBUTOR_BALANCE_FLOOR: [' 11 ', '11'],
};

async function valorCom(nome: Nome, v: string | undefined) {
  vi.resetModules();
  vi.stubEnv(nome, v as string);
  const mod = (await import('@/lib/stellar/config')) as unknown as Record<string, unknown>;
  return mod[EXPORT[nome]];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe.each(Object.keys(EXPORT) as Nome[])('%s', (nome) => {
  it('vazia → padrão', async () => expect(await valorCom(nome, '')).toEqual(PADRAO[nome]));
  it('só espaços → padrão', async () => expect(await valorCom(nome, '   ')).toEqual(PADRAO[nome]));
  it('ausente → padrão', async () => expect(await valorCom(nome, undefined)).toEqual(PADRAO[nome]));
  it('preenchida → o valor, sem espaços nas pontas', async () =>
    expect(await valorCom(nome, PREENCHIDO[nome][0])).toEqual(PREENCHIDO[nome][1]));
});
