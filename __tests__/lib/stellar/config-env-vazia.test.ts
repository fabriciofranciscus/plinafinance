import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Env vazia não pode virar valor vazio (Atlas, 16/11, extensão do fix/horizon-url-vazia): `??` só cai no padrão com
 * undefined. Ex.: FUNDER_DAILY_CAP='' virava Number('') = 0 (teto 0); ASSET_CODE='' virava código vazio.
 */
type Nome = 'FUNDER_DAILY_CAP' | 'ASSET_CODE' | 'FUNDER_BALANCE_FLOOR' | 'ISSUER_BALANCE_FLOOR' | 'DISTRIBUTOR_BALANCE_FLOOR';
const EXPORT: Record<Nome, string> = {
  FUNDER_DAILY_CAP: 'FUNDER_DAILY_CAP',
  ASSET_CODE: 'assetCode',
  FUNDER_BALANCE_FLOOR: 'FUNDER_BALANCE_FLOOR',
  ISSUER_BALANCE_FLOOR: 'ISSUER_BALANCE_FLOOR',
  DISTRIBUTOR_BALANCE_FLOOR: 'DISTRIBUTOR_BALANCE_FLOOR',
};
const PADRAO: Record<Nome, unknown> = {
  FUNDER_DAILY_CAP: 100,
  ASSET_CODE: 'PLINARF',
  FUNDER_BALANCE_FLOOR: '50',
  ISSUER_BALANCE_FLOOR: '5',
  DISTRIBUTOR_BALANCE_FLOOR: '5',
};
const PREENCHIDO: Record<Nome, [string, unknown]> = {
  FUNDER_DAILY_CAP: [' 7 ', 7],
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
