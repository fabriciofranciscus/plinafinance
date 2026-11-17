import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * FUNDER_DAILY_CAP é obrigatório e fail-closed (decisão do Atlas, 16/11): funding de dinheiro real não pode ficar
 * aberto por omissão de configuração. Vazio/ilegível/zero/negativo/decimal → recusa em qualquer rede; ausente → 100 na
 * TESTNET e recusa na PUBLIC. A recusa vem ANTES de qualquer consulta.
 * Antes: vazio virava Number('') = 0 e 'abc' virava NaN, e `count >= NaN` é sempre falso (funding SEM teto).
 */
const ORIG = { network: process.env.STELLAR_NETWORK, secret: process.env.STELLAR_FUNDER_SECRET, pub: process.env.STELLAR_FUNDER_PUBLIC, cap: process.env.FUNDER_DAILY_CAP };
const FUNDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const DEST = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();

const eventoAuditCount = vi.fn();
vi.mock('@/lib/db', () => ({ db: { eventoAudit: { count: eventoAuditCount, create: vi.fn() } } }));

beforeEach(() => {
  process.env.STELLAR_NETWORK = 'PUBLIC';
  process.env.STELLAR_FUNDER_SECRET = FUNDER.secret();
  process.env.STELLAR_FUNDER_PUBLIC = FUNDER.publicKey();
  eventoAuditCount.mockReset().mockResolvedValue(0);
});
afterEach(() => {
  for (const [k, v] of [['STELLAR_NETWORK', ORIG.network], ['STELLAR_FUNDER_SECRET', ORIG.secret], ['STELLAR_FUNDER_PUBLIC', ORIG.pub], ['FUNDER_DAILY_CAP', ORIG.cap]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

async function fundarCom(cap: string | undefined) {
  if (cap === undefined) delete process.env.FUNDER_DAILY_CAP;
  else process.env.FUNDER_DAILY_CAP = cap;
  vi.resetModules();
  const account = await import('@/lib/stellar/account');
  vi.spyOn(account.horizon, 'loadAccount').mockRejectedValueOnce({ response: { status: 404 } }); // destino novo
  return { account, p: account.fundAccountIfNeeded(DEST) };
}

async function capDaConfig(rede: 'TESTNET' | 'PUBLIC', cap: string | undefined) {
  process.env.STELLAR_NETWORK = rede;
  if (cap === undefined) delete process.env.FUNDER_DAILY_CAP;
  else process.env.FUNDER_DAILY_CAP = cap;
  vi.resetModules();
  return (await import('@/lib/stellar/config')).FUNDER_DAILY_CAP;
}

describe('FUNDER_DAILY_CAP: leitura (fronteiras do Argus + decisão do Atlas, 16/11)', () => {
  // Teto de 6 dígitos (detalhe do Argus em 5ecde15): '1000000' e acima → recusa; '9'.repeat(400) viraria Infinity.
  const RECUSA = ['', '   ', 'abc', '1e3', '-1', '0', '10.5', '1.0', '0x10', '1000000', '9'.repeat(400)];
  it.each(RECUSA.flatMap((v) => [['TESTNET', v], ['PUBLIC', v]] as const))('%s, %j → null (recusa) nas duas redes', async (rede, v) => {
    expect(await capDaConfig(rede, v)).toBeNull();
  });
  it.each([
    ['TESTNET', '1', 1], ['PUBLIC', '1', 1], ['TESTNET', '100', 100], ['PUBLIC', ' 100 ', 100],
    ['PUBLIC', '999999', 999999],
  ] as const)('%s, %j → %d', async (rede, v, esperado) => {
    expect(await capDaConfig(rede, v)).toBe(esperado);
  });
  it('AUSENTE na TESTNET → 100 (não quebra o deploy de hoje)', async () => {
    expect(await capDaConfig('TESTNET', undefined)).toBe(100);
  });
  it('AUSENTE na PUBLIC → null (recusa)', async () => {
    expect(await capDaConfig('PUBLIC', undefined)).toBeNull();
  });
});

describe('fundAccountIfNeeded (PUBLIC) com o cap', () => {
  it.each([['ausente', undefined], ['vazio', ''], ['ilegível', 'abc'], ['1e3', '1e3'], ['zero', '0'], ['negativo', '-1'], ['decimal', '10.5']])(
    '%s → recusa com mensagem fixa, sem consultar o banco',
    async (_r, cap) => {
      const { p } = await fundarCom(cap);
      await expect(p).rejects.toThrow('FUNDER_DAILY_CAP ausente ou inválido — funding recusado (configure um inteiro ≥ 1)');
      expect(eventoAuditCount).not.toHaveBeenCalled();
    },
  );

  it('"1" com 1 conta hoje → "daily cap atingido" (o limite vale)', async () => {
    eventoAuditCount.mockResolvedValueOnce(1);
    const { p } = await fundarCom('1');
    await expect(p).rejects.toThrow(/daily cap atingido \(1\/1\)/);
  });

  it('"100" com 100 contas hoje → "daily cap atingido"', async () => {
    eventoAuditCount.mockResolvedValueOnce(100);
    const { p } = await fundarCom('100');
    await expect(p).rejects.toThrow(/daily cap atingido \(100\/100\)/);
  });
});
