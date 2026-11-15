import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** E1-p — registro canônico da incorporação (contratos/2026-11-13-e1-p-incorporacao-ancorada.md). */
const st = vi.hoisted(() => ({
  pix: null as null | Record<string, unknown>,
  cessao: null as null | Record<string, unknown>,
  ancorar: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    transferenciaPix: { findUnique: vi.fn(async () => st.pix) },
    cessao: { findUnique: vi.fn(async () => st.cessao) },
  },
}));
vi.mock('@/lib/stellar/ancora', () => ({ ancorarSha256: st.ancorar }));

import { bytesCanonicos } from '@/lib/services/json-canonico';
import { RegistroIncorporacaoError, ancorarRegistroIncorporacao, montarRegistroIncorporacao } from '@/lib/services/registro-incorporacao';

const D = (v: string) => new Prisma.Decimal(v);
const entrada = {
  cotaId: 'inc_abc', cessaoId: 'ces_1', hashLaudo: 'a'.repeat(64),
  valorIncorporadoBrl: D('400'), tokensEmitir: D('400'), navPorTokenUsado: D('1'),
  issuer: 'GISSUER', asset: 'PLINARF',
};

beforeEach(() => {
  st.pix = { status: 'COMPROVADA', comprovanteSha256: 'c'.repeat(64), ancoraTxHash: 'd'.repeat(64) };
  st.cessao = { status: 'ASSINADA', hashDocumento: 'b'.repeat(64) };
  st.ancorar.mockReset().mockResolvedValue({ txHash: 'e'.repeat(64), reutilizada: false, ledgerCloseTime: 'x' });
});

describe('montarRegistroIncorporacao', () => {
  it('registro canônico com os campos do contrato, valores em string, memo = SHA-256 dos bytes canônicos', async () => {
    const r = await montarRegistroIncorporacao(entrada);
    expect(r.registro).toEqual({
      tipo: 'COTA_INCORPORADA', versao: 1, cotaId: 'inc_abc', cessaoId: 'ces_1', hashLaudo: 'a'.repeat(64),
      sha256PdfCessao: 'b'.repeat(64), comprovantePixSha256: 'c'.repeat(64), comprovantePixAncoraTxHash: 'd'.repeat(64),
      valorIncorporadoBrl: '400.00', tokensEmitir: '400.0000000', navPorTokenUsado: '1.00000000',
      issuer: 'GISSUER', asset: 'PLINARF',
    });
    expect(r.bytes.equals(bytesCanonicos(r.registro))).toBe(true);
    expect(r.sha256Hex).toBe(createHash('sha256').update(r.bytes).digest('hex'));
  });

  it('sem PII: nenhuma chave de pessoa, destino ou chave Pix', async () => {
    const r = await montarRegistroIncorporacao(entrada);
    const chaves = Object.keys(r.registro).join(' ');
    expect(chaves).not.toMatch(/nome|email|cpf|cnpj|telefone|destino|chavePix|titular/i);
  });

  it('Pix ainda não COMPROVADA, ou sem transferência → campos do Pix null', async () => {
    st.pix = { status: 'INCERTO', comprovanteSha256: 'c'.repeat(64), ancoraTxHash: null };
    expect((await montarRegistroIncorporacao(entrada)).registro).toMatchObject({ comprovantePixSha256: null, comprovantePixAncoraTxHash: null });
    st.pix = null;
    expect((await montarRegistroIncorporacao(entrada)).registro).toMatchObject({ comprovantePixSha256: null, comprovantePixAncoraTxHash: null });
  });

  it('cessão sem PDF guardado (DS3 fora) ou não assinada → sha256PdfCessao null; sem cessão → cessaoId null', async () => {
    st.cessao = { status: 'ASSINADA', hashDocumento: null };
    expect((await montarRegistroIncorporacao(entrada)).registro.sha256PdfCessao).toBeNull();
    st.cessao = { status: 'ENVIADA_DOCUSIGN', hashDocumento: 'b'.repeat(64) };
    expect((await montarRegistroIncorporacao(entrada)).registro.sha256PdfCessao).toBeNull();
    const r = await montarRegistroIncorporacao({ ...entrada, cessaoId: null });
    expect(r.registro).toMatchObject({ cessaoId: null, sha256PdfCessao: null, comprovantePixSha256: null });
  });

  it('determinístico: mesmos números → mesmos bytes (a recuperação reusa a âncora)', async () => {
    const a = await montarRegistroIncorporacao(entrada);
    const b = await montarRegistroIncorporacao({ ...entrada, tokensEmitir: D('400.0000000'), navPorTokenUsado: D('1.00000000') });
    expect(a.sha256Hex).toBe(b.sha256Hex);
  });
});

describe('ancorarRegistroIncorporacao', () => {
  it('ancora pelo distributor com contexto COTA_INCORPORADA e desde, e devolve a tx', async () => {
    const desde = new Date('2026-11-13T12:00:00Z');
    const r = await ancorarRegistroIncorporacao({ ...entrada, desde });
    expect(st.ancorar).toHaveBeenCalledWith({ sha256Hex: r.sha256Hex, contexto: 'COTA_INCORPORADA', desde, semEspera: true });
    expect(r.ancoraTxHash).toBe('e'.repeat(64));
  });

  it('falha da âncora → RegistroIncorporacaoError (fail-closed), sem engolir', async () => {
    st.ancorar.mockRejectedValue(new Error('horizon fora'));
    await expect(ancorarRegistroIncorporacao({ ...entrada, desde: new Date() })).rejects.toBeInstanceOf(RegistroIncorporacaoError);
  });
});

describe('âncora sem espera (I1)', () => {
  it('pede semEspera e marca ambígua quando a âncora não confirmou', async () => {
    st.ancorar.mockRejectedValue(Object.assign(new Error('nc'), { code: 'ANCORA_NAO_CONFIRMADA' }));
    const err = await ancorarRegistroIncorporacao({ ...entrada, desde: new Date() }).catch((e: unknown) => e);
    expect(st.ancorar).toHaveBeenCalledWith(expect.objectContaining({ semEspera: true }));
    expect((err as RegistroIncorporacaoError).ambigua).toBe(true);
  });
});
