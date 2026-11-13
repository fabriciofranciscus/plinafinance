import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { eventoAudit: { findFirst: m.findFirst, create: m.create } } }));

import { registrarTes3Queimada, Tes3RegistroError } from '@/lib/services/tesouraria-excesso';

// Chaves FORA de ordem alfabética e com espaços internos: o jsonb reordenaria; a string exata tem de ficar guardada.
const REGISTRO = '{"tipo":"TES-3","code":"PLINARF","amount":"2154540.0000000","de":"GDE","para":"GPARA"}';
const HASH = 'a'.repeat(64);
const MEMO = createHash('sha256').update(REGISTRO, 'utf8').digest('hex');
const NOTA = { carteirasForaDaPosicao: 5, somaForaDaPosicao: '2385.6664382', valorTransferidoAproxBrl: '2022' };
const base = { hash: HASH, registroJson: REGISTRO, memoHashHex: MEMO, operador: 'script-tes-3', nota: NOTA };

beforeEach(() => {
  m.findFirst.mockReset().mockResolvedValue(null);
  m.create.mockReset().mockResolvedValue({});
});

describe('registrarTes3Queimada', () => {
  it('grava o EventoAudit com os bytes exatos, payloadHash = SHA-256 = memo, e a nota da Consuelo, sem MovimentoFundo', async () => {
    const r = await registrarTes3Queimada(base);
    expect(r).toEqual({ registrado: true, payloadHash: MEMO });
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ acao: 'TESOURARIA_EXCESSO_QUEIMADA', operador: 'script-tes-3', stellarTxHash: HASH, payloadHash: MEMO });
    expect(data.payloadJson.registroCanonico).toBe(REGISTRO); // string exata, não reserializada
    expect(createHash('sha256').update(data.payloadJson.registroCanonico, 'utf8').digest('hex')).toBe(data.payloadHash);
    expect(data.payloadJson).toMatchObject({
      movimentoOnChain: true, movimentoFundo: false,
      carteirasForaDaPosicao: 5, somaForaDaPosicao: '2385.6664382', valorTransferidoAproxBrl: '2022',
    });
  });

  it('idempotente por hash da tx: 2ª chamada não grava', async () => {
    m.findFirst.mockResolvedValue({ id: 'ev_1' });
    expect(await registrarTes3Queimada(base)).toEqual({ registrado: false, payloadHash: MEMO });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ acao: 'TESOURARIA_EXCESSO_QUEIMADA', stellarTxHash: HASH });
  });

  it('memo que não é o SHA-256 do registro → MEMO_DIVERGE e nada gravado (maiúsculas do memo valem)', async () => {
    await expect(registrarTes3Queimada({ ...base, memoHashHex: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'MEMO_DIVERGE' });
    expect(m.create).not.toHaveBeenCalled();
    await expect(registrarTes3Queimada({ ...base, memoHashHex: MEMO.toUpperCase() })).resolves.toMatchObject({ registrado: true });
  });

  it('um espaço a mais no registro muda o hash e é recusado contra o memo', async () => {
    await expect(registrarTes3Queimada({ ...base, registroJson: `${REGISTRO} ` })).rejects.toMatchObject({ code: 'MEMO_DIVERGE' });
    await expect(registrarTes3Queimada({ ...base, registroJson: `${REGISTRO}\n` })).rejects.toMatchObject({ code: 'MEMO_DIVERGE' });
    expect(m.create).not.toHaveBeenCalled();
  });

  it.each([
    ['hash inválido', { hash: 'xyz' }, 'HASH_INVALIDO'],
    ['hash em maiúsculas', { hash: 'A'.repeat(64) }, 'HASH_INVALIDO'],
    ['registro não é JSON', { registroJson: 'nada', memoHashHex: undefined }, 'REGISTRO_INVALIDO'],
    ['registro é array', { registroJson: '[1]', memoHashHex: undefined }, 'REGISTRO_INVALIDO'],
    ['registro de outra operação (TES-2)', { registroJson: '{"tipo":"TES-2"}', memoHashHex: undefined }, 'TIPO_INVALIDO'],
    ['nota: carteiras negativas', { nota: { ...NOTA, carteirasForaDaPosicao: -1 } }, 'NOTA_INVALIDA'],
    ['nota: carteiras não inteiras', { nota: { ...NOTA, carteirasForaDaPosicao: 1.5 } }, 'NOTA_INVALIDA'],
    ['nota: soma com sinal', { nota: { ...NOTA, somaForaDaPosicao: '-1' } }, 'NOTA_INVALIDA'],
    ['nota: valor com texto', { nota: { ...NOTA, valorTransferidoAproxBrl: '≈ 2022' } }, 'NOTA_INVALIDA'],
  ])('%s → %s, nada gravado', async (_n, over, code) => {
    await expect(registrarTes3Queimada({ ...base, ...over } as never)).rejects.toMatchObject({ code });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('o erro é Tes3RegistroError', async () => {
    await expect(registrarTes3Queimada({ ...base, hash: 'x' })).rejects.toBeInstanceOf(Tes3RegistroError);
  });

  it('o registro real da TES-3 (arquivo do Farol) bate com o memo da tx', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const f = `${process.env.HOME}/OpenBot/Shared/plina/evidencias/tes-3/registro.json`;
    if (!existsSync(f)) return; // só onde o arquivo de evidência existe
    const bytes = readFileSync(f, 'utf8');
    expect(createHash('sha256').update(bytes, 'utf8').digest('hex')).toBe('b6841e3ac08ee3738ee59b9e2bc19688eea647d31d9c9a80da0f2c76d7d34f7a');
    expect(JSON.parse(bytes).tipo).toBe('TES-3');
  });
});
