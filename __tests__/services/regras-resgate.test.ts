import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { Account, Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';
import {
  amountPlinarfValido,
  assinaturaUnicaDoInvestidor,
  bridgeAmountDoResgate,
  precoLiquidoDoTesouro,
  memoHashDoResgate,
  precoNaFaixa,
  tetoResgateBrl,
  TETO_RESGATE_BRL_PADRAO,
} from '@/lib/services/regras-resgate';

const D = (v: string) => new Prisma.Decimal(v);
const AGORA = 1_800_000_000;

function tx(tb: [number, number] | null, assinar?: Keypair) {
  const k = assinar ?? Keypair.random();
  const b = new TransactionBuilder(new Account(k.publicKey(), '1'), { fee: '100', networkPassphrase }).addOperation(
    Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }),
  );
  const t = tb ? b.setTimebounds(tb[0], tb[1]).build() : b.setTimeout(0).build();
  if (assinar) t.sign(assinar);
  return t;
}

describe('amountPlinarfValido', () => {
  it('aceita decimal > 0 com até 7 casas; recusa o resto', () => {
    expect(amountPlinarfValido('10')?.toFixed(7)).toBe('10.0000000');
    expect(amountPlinarfValido('0.0000001')).not.toBeNull();
    for (const ruim of ['0', '0.0', '-1', '1.00000001', '1e3', 'abc', '', ' 1', 10, null, undefined, '1'.repeat(13)]) {
      expect(amountPlinarfValido(ruim), String(ruim)).toBeNull();
    }
  });
});

describe('precoLiquidoDoTesouro ((fromAmount − fee) ÷ toAmount)', () => {
  it('desconta o fee, na mesma base da subscrição', () => {
    // R$ 10.000 com fee R$ 50 comprou 8.500 TESOURO → preço líquido 9.950 ÷ 8.500
    expect(precoLiquidoDoTesouro({ fromAmount: '10000', fee: '50', toAmount: '8500' })?.toFixed(6)).toBe('1.170588');
    expect(precoLiquidoDoTesouro({ fromAmount: '100', fee: '0', toAmount: '85.54' })?.toFixed(5)).toBe('1.16904');
  });

  it('fee vazio/nulo = 0; dado inválido, fee negativo, toAmount ≤ 0 ou resultado ≤ 0 → null', () => {
    expect(precoLiquidoDoTesouro({ fromAmount: '100', fee: '', toAmount: '80' })?.toFixed(2)).toBe('1.25');
    expect(precoLiquidoDoTesouro({ fromAmount: '100', fee: null, toAmount: '80' })?.toFixed(2)).toBe('1.25');
    for (const q of [
      { fromAmount: 'abc', fee: '0', toAmount: '80' },
      { fromAmount: '100', fee: '-1', toAmount: '80' },
      { fromAmount: '100', fee: '0', toAmount: '0' },
      { fromAmount: '100', fee: '100', toAmount: '80' },
      { fromAmount: '100', fee: '150', toAmount: '80' },
      { fromAmount: '100', fee: 'x', toAmount: '80' },
    ]) {
      expect(precoLiquidoDoTesouro(q), JSON.stringify(q)).toBeNull();
    }
  });
});

describe('bridgeAmountDoResgate (TESOURO = BRL ÷ preço líquido, para baixo)', () => {
  it('divide e trunca a 7 casas PARA BAIXO (favorece o fundo)', () => {
    expect(bridgeAmountDoResgate(D('100.00'), '1.25')?.toFixed(7)).toBe('80.0000000');
    expect(bridgeAmountDoResgate(D('1.00'), '3')?.toFixed(7)).toBe('0.3333333'); // não arredonda para ...34
    expect(bridgeAmountDoResgate(D('10.00'), D('1.170588'))?.toFixed(7)).toBe('8.5427152'); // 8,54271… (conferido: 8,5427153 × 1,170588 > 10)
  });

  it('preço inválido, zero ou negativo, ou resultado zero → null', () => {
    for (const t of ['abc', '0', '-1', 'NaN', 'Infinity', '']) expect(bridgeAmountDoResgate(D('100'), t), t).toBeNull();
    expect(bridgeAmountDoResgate(D('0.01'), '1000000')).toBeNull();
  });
});

describe('memoHashDoResgate', () => {
  it('32 bytes, determinístico por cotação e SEM o prefixo exclusivo da emissão', () => {
    const a = memoHashDoResgate('q_1');
    expect(a).toHaveLength(32);
    expect(a.equals(memoHashDoResgate('q_1'))).toBe(true);
    expect(a.equals(memoHashDoResgate('q_2'))).toBe(false);
    const incorporacao = require('node:crypto').createHash('sha256').update('plina:incorporacao:q_1').digest();
    expect(a.equals(incorporacao)).toBe(false);
  });
});

describe('assinaturaUnicaDoInvestidor', () => {
  it('uma assinatura válida do investidor → 64 bytes; ausente, de outro, ou duas → null', () => {
    const inv = Keypair.random();
    const ok = tx([0, AGORA + 100], inv);
    expect(assinaturaUnicaDoInvestidor(ok, inv.publicKey())).toHaveLength(64);
    expect(assinaturaUnicaDoInvestidor(ok, Keypair.random().publicKey())).toBeNull();
    expect(assinaturaUnicaDoInvestidor(tx([0, AGORA + 100]), inv.publicKey())).toBeNull(); // sem assinatura
    const dupla = tx([0, AGORA + 100], inv);
    dupla.sign(Keypair.random());
    expect(assinaturaUnicaDoInvestidor(dupla, inv.publicKey())).toBeNull();
  });
});

describe('precoNaFaixa (Argus R2: ±2% contra a referência independente)', () => {
  const REF = '1.25';
  it('dentro da faixa (inclusive nas bordas exatas)', () => {
    expect(precoNaFaixa('1.25', REF)).toBe(true);
    expect(precoNaFaixa('1.275', REF)).toBe(true); // +2,00%
    expect(precoNaFaixa('1.225', REF)).toBe(true); // −2,00%
  });
  it('fora da faixa: acima, abaixo e preço inflado/zerado', () => {
    expect(precoNaFaixa('1.2751', REF)).toBe(false);
    expect(precoNaFaixa('1.2249', REF)).toBe(false);
    expect(precoNaFaixa('12.5', REF)).toBe(false);
    expect(precoNaFaixa('0.0001', REF)).toBe(false);
  });
  it('inválido → false (fail-closed): zero, negativo, lixo, referência inválida', () => {
    for (const bad of ['0', '-1', 'abc', '', 'NaN', 'Infinity']) {
      expect(precoNaFaixa(bad, REF)).toBe(false);
      expect(precoNaFaixa('1.25', bad)).toBe(false);
    }
  });
  it('a faixa é configurável em bps', () => {
    expect(precoNaFaixa('1.26', REF, 50)).toBe(false); // +0,8% > 0,5%
    expect(precoNaFaixa('1.26', REF, 100)).toBe(true);
  });
});

describe('tetoResgateBrl (Argus R2)', () => {
  it('config válida manda; inválida/ausente → padrão provisório (nunca "sem teto")', () => {
    expect(tetoResgateBrl('2500.50').toString()).toBe('2500.5');
    for (const bad of [undefined, '', '  ', 'abc', '0', '-5', 'Infinity']) {
      expect(tetoResgateBrl(bad).toString()).toBe(TETO_RESGATE_BRL_PADRAO);
    }
  });
});
