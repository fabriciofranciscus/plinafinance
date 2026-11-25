import { describe, it, expect } from 'vitest';

import { decidirEmissaoDoSeed, memoHashDoSeed } from '@/lib/services/seed-emissao';

/**
 * Seed idempotente contra o ledger. Incidente de origem: em 16/11/2026 um banco
 * vazio rodou o seed duas vezes contra o issuer compartilhado da testnet e
 * emitiu as mesmas 3 cotas duas vezes. /pool publicou NAV/token de -R$ 19.409.
 */

const base = { slug: 'imovel-sp-250k', code: 'PLINARF', quantidade: '205000.0000000' };

describe('decidirEmissaoDoSeed', () => {
  it('recusa o incidente de 16/11: banco vazio diante de um ledger já emitido', () => {
    const d = decidirEmissaoDoSeed({ ...base, existente: null, emitidoNoLedger: '387400', noRazao: '0' });
    expect(d.acao).toBe('recusar');
    if (d.acao !== 'recusar') return;
    expect(d.motivo).toContain('387400.0000000 tokens no ledger não têm lastro neste banco');
  });

  it('recusa a 2ª rodada mesmo depois que a 1ª gravou uma cota no razão', () => {
    const d = decidirEmissaoDoSeed({
      ...base,
      slug: 'veiculo-mg-80k',
      quantidade: '62400.0000000',
      existente: null,
      emitidoNoLedger: '592400',
      noRazao: '205000',
    });
    expect(d.acao).toBe('recusar');
  });

  it('adota a emissão do seed que o ledger já tem, sem olhar o supply', () => {
    const d = decidirEmissaoDoSeed({
      ...base,
      existente: { txHash: 'abc', amount: '205000.0000000' },
      emitidoNoLedger: '387400',
      noRazao: '0',
    });
    expect(d).toEqual({ acao: 'adotar', txHash: 'abc' });
  });

  it('não adota se a quantidade no ledger não bate', () => {
    const d = decidirEmissaoDoSeed({
      ...base,
      existente: { txHash: 'abc', amount: '200000.0000000' },
      emitidoNoLedger: '387400',
      noRazao: '0',
    });
    expect(d.acao).toBe('recusar');
  });

  it('emite com ledger e razão batendo, inclusive vazios', () => {
    expect(decidirEmissaoDoSeed({ ...base, existente: null, emitidoNoLedger: '0', noRazao: '0' }).acao).toBe('emitir');
    expect(decidirEmissaoDoSeed({ ...base, existente: null, emitidoNoLedger: '205000', noRazao: '205000' }).acao).toBe('emitir');
  });

  it('emite com o ledger abaixo do razão (queima fora do razão)', () => {
    expect(decidirEmissaoDoSeed({ ...base, existente: null, emitidoNoLedger: '100', noRazao: '205000' }).acao).toBe('emitir');
  });
});

describe('memoHashDoSeed', () => {
  it('tem 32 bytes e é determinístico por asset e slug', () => {
    const m = memoHashDoSeed('imovel-sp-250k', 'PLINARF');
    expect(m).toHaveLength(32);
    expect(m.equals(memoHashDoSeed('imovel-sp-250k', 'PLINARF'))).toBe(true);
    expect(m.equals(memoHashDoSeed('veiculo-mg-80k', 'PLINARF'))).toBe(false);
    expect(m.equals(memoHashDoSeed('imovel-sp-250k', 'PLINARFB'))).toBe(false);
  });
});
