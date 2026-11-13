/**
 * QA Vera — TES-3: EventoAudit TESOURARIA_EXCESSO_QUEIMADA com Postgres REAL (o teste do dev mocka o banco). Prova a
 * gravação dos bytes exatos (jsonb reordena chaves), payloadHash = SHA-256 = memo, idempotência por hash da tx (inclusive sob
 * concorrência), recusas sem escrita e ausência de efeito no razão do fundo. Opt-in: TEST_PG_URL local.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
  }
  return url;
});

import { db } from '@/lib/db';
import { registrarTes3Queimada, Tes3RegistroError } from '@/lib/services/tesouraria-excesso';

// chaves FORA de ordem alfabética e espaços internos: o jsonb reordena; os bytes exatos têm de ficar guardados
const REGISTRO = '{"tipo":"TES-3","code":"PLINARF","amount":"2154540.0000000","de":"GDE","para":"GPARA","z":1,"a":[3,1,2]}';
const MEMO = createHash('sha256').update(REGISTRO, 'utf8').digest('hex');
const HASH = '7'.repeat(64);
const NOTA = { carteirasForaDaPosicao: 5, somaForaDaPosicao: '2385.6664382', valorTransferidoAproxBrl: '2022' };
const base = { hash: HASH, registroJson: REGISTRO, memoHashHex: MEMO, operador: 'script-tes-3', nota: NOTA };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const erro = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as (Error & { code?: string }) | null;
const eventos = () => db.eventoAudit.findMany({ where: { acao: 'TESOURARIA_EXCESSO_QUEIMADA' } });

describe.skipIf(!PG)('TES-3 — registro do evento (Postgres real)', () => {
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE "MovimentoFundo", "EventoAudit" RESTART IDENTITY CASCADE'); });

  it('grava UM evento: payloadHash = SHA-256 dos bytes = memo; a string EXATA (ordem das chaves) sobrevive ao jsonb; nota da Consuelo; sem MovimentoFundo', async () => {
    const r = await registrarTes3Queimada(base);
    expect(r).toEqual({ registrado: true, payloadHash: MEMO });
    const [ev] = await eventos();
    expect(ev).toMatchObject({ stellarTxHash: HASH, payloadHash: MEMO, operador: 'script-tes-3' });
    const pj = ev.payloadJson as Record<string, any>;
    expect(pj.registroCanonico).toBe(REGISTRO);                    // bytes exatos
    expect(sha(pj.registroCanonico)).toBe(ev.payloadHash);         // recalculável pelo auditor
    expect(Object.keys(pj.registro)).not.toEqual(Object.keys(JSON.parse(REGISTRO))); // o objeto jsonb foi reordenado (por isso a string)
    expect(pj).toMatchObject({ movimentoOnChain: true, movimentoFundo: false, carteirasForaDaPosicao: 5, somaForaDaPosicao: '2385.6664382', valorTransferidoAproxBrl: '2022' });
    expect(await db.movimentoFundo.count()).toBe(0);
  });

  it('o registro REAL da TES-3 (evidencias/tes-3/registro.json) tem o SHA-256 que está no memo da tx na testnet (conferido na Horizon em 13/11) e é gravável', async () => {
    const f = `${process.env.HOME}/OpenBot/Shared/plina/evidencias/tes-3/registro.json`;
    if (!existsSync(f)) return;
    const bytes = readFileSync(f, 'utf8');
    expect(sha(bytes)).toBe('b6841e3ac08ee3738ee59b9e2bc19688eea647d31d9c9a80da0f2c76d7d34f7a');
    const r = await registrarTes3Queimada({ hash: '7ccc53696e0712acb5d13e49a2a0676557d93029b81492a8e755706f44d92688', registroJson: bytes, memoHashHex: 'b6841e3ac08ee3738ee59b9e2bc19688eea647d31d9c9a80da0f2c76d7d34f7a', operador: 'qa', nota: NOTA });
    expect(r.registrado).toBe(true);
    expect(sha(((await eventos())[0].payloadJson as any).registroCanonico)).toBe('b6841e3ac08ee3738ee59b9e2bc19688eea647d31d9c9a80da0f2c76d7d34f7a');
  });

  it('idempotente por hash da tx: a 2ª chamada devolve registrado:false e não grava', async () => {
    await registrarTes3Queimada(base);
    expect(await registrarTes3Queimada(base)).toEqual({ registrado: false, payloadHash: MEMO });
    expect(await eventos()).toHaveLength(1);
  });

  it.fails('F-TES3-1 (BAIXO) — 5 chamadas SIMULTÂNEAS (reexecução/duplo clique do script): deveria haver exatamente 1 evento; a idempotência é check-then-insert sem UNIQUE nem lock (interleaving forçado por barreira entre o SELECT e o INSERT) e grava 5', async () => {
    const real = db.eventoAudit.findFirst.bind(db.eventoAudit);
    let chegaram = 0; let libera!: () => void; const espera = new Promise<void>((r) => { libera = r; });
    vi.spyOn(db.eventoAudit, 'findFirst').mockImplementation(((...args: Parameters<typeof real>) => {
      const p = real(...args);
      return p.then(async (r) => { chegaram += 1; if (chegaram >= 5) libera(); await espera; return r; });
    }) as never);
    try {
      await Promise.all(Array.from({ length: 5 }, () => registrarTes3Queimada(base)));
      expect((await eventos()).length).toBe(1);
    } finally { vi.restoreAllMocks(); }
  });

  it('outro hash de tx com o MESMO registro grava um 2º evento (a chave é a tx, não o registro) — caracterização', async () => {
    await registrarTes3Queimada(base);
    await registrarTes3Queimada({ ...base, hash: '8'.repeat(64) });
    expect(await eventos()).toHaveLength(2);
  });

  it.each([
    ['hash curto', { hash: 'abc' }, 'HASH_INVALIDO'],
    ['hash em maiúsculas', { hash: 'A'.repeat(64) }, 'HASH_INVALIDO'],
    ['registro não é JSON', { registroJson: '{nao json' }, 'REGISTRO_INVALIDO'],
    ['registro é array', { registroJson: '[1,2]' }, 'REGISTRO_INVALIDO'],
    ['registro com BOM (arquivo salvo com BOM)', { registroJson: '﻿' + REGISTRO }, 'REGISTRO_INVALIDO'],
    ['tipo diferente de TES-3', { registroJson: '{"tipo":"OUTRA"}' }, 'TIPO_INVALIDO'],
    ['memo que não é o SHA-256 do registro', { memoHashHex: 'f'.repeat(64) }, 'MEMO_DIVERGE'],
    ['espaço a mais no registro (hash muda)', { registroJson: REGISTRO + ' ' }, 'MEMO_DIVERGE'],
    ['quebra de linha CRLF no fim', { registroJson: REGISTRO + '\r\n' }, 'MEMO_DIVERGE'],
    ['nota: negativa', { nota: { ...NOTA, carteirasForaDaPosicao: -1 } }, 'NOTA_INVALIDA'],
    ['nota: fracionária', { nota: { ...NOTA, carteirasForaDaPosicao: 1.5 } }, 'NOTA_INVALIDA'],
    ['nota: decimal com sinal', { nota: { ...NOTA, valorTransferidoAproxBrl: '-5' } }, 'NOTA_INVALIDA'],
    ['nota: notação científica', { nota: { ...NOTA, somaForaDaPosicao: '1e3' } }, 'NOTA_INVALIDA'],
    ['nota: 8 casas decimais', { nota: { ...NOTA, somaForaDaPosicao: '1.12345678' } }, 'NOTA_INVALIDA'],
    ['nota: texto', { nota: { ...NOTA, valorTransferidoAproxBrl: 'NaN' } }, 'NOTA_INVALIDA'],
  ])('recusa %s com %s e NADA é gravado', async (_n, over, code) => {
    const e = await erro(registrarTes3Queimada({ ...base, ...(over as object) } as never));
    expect(e).toBeInstanceOf(Tes3RegistroError);
    expect(e!.code).toBe(code);
    expect(await db.eventoAudit.count()).toBe(0);
  });

  it('sem memo informado o hash do evento é o SHA-256 do registro (o memo é opcional na API do serviço)', async () => {
    const { memoHashHex: _m, ...semMemo } = base;
    expect((await registrarTes3Queimada(semMemo)).payloadHash).toBe(MEMO);
  });

  it('o evento não carrega PII: só quantidades, endereços do registro e o operador constante', async () => {
    await registrarTes3Queimada(base);
    const txt = JSON.stringify(await eventos());
    expect(txt).not.toMatch(/@|cpf|nome|email/i);
  });
});
