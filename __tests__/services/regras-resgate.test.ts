import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { Account, Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';
import {
  amountPlinarfValido,
  assertJanelaDoResgate,
  assinaturaUnicaDoInvestidor,
  bridgeAmountDoResgate,
  memoHashDoResgate,
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

describe('bridgeAmountDoResgate (TESOURO = BRL × taxa, para baixo)', () => {
  it('multiplica e trunca a 7 casas PARA BAIXO (favorece o fundo)', () => {
    expect(bridgeAmountDoResgate(D('100.00'), '0.8554')?.toFixed(7)).toBe('85.5400000');
    expect(bridgeAmountDoResgate(D('1.00'), '0.33333339')?.toFixed(7)).toBe('0.3333333'); // não arredonda para ...34
  });

  it('taxa inválida, zero, negativa ou resultado zero → null', () => {
    for (const t of ['abc', '0', '-1', 'NaN', 'Infinity', '']) expect(bridgeAmountDoResgate(D('100'), t), t).toBeNull();
    expect(bridgeAmountDoResgate(D('0.01'), '0.000001')).toBeNull();
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

describe('assertJanelaDoResgate (N1-S1 estendido ao resgate)', () => {
  const expira = new Date((AGORA + 300) * 1000);

  it('aceita janela curta e aberta dentro do prazo da cotação', () => {
    expect(() => assertJanelaDoResgate(tx([0, AGORA + 120]), expira, AGORA)).not.toThrow();
    expect(() => assertJanelaDoResgate(tx([AGORA + 3, AGORA + 120]), expira, AGORA)).not.toThrow();
  });

  it('já expirada passa (a órfã é decidida pela rede, não pela janela)', () => {
    expect(() => assertJanelaDoResgate(tx([0, AGORA - 600]), expira, AGORA)).not.toThrow();
  });

  it('recusa sem timeBounds, maxTime 0, > agora+180 s, > prazo da cotação+120 s e minTime futuro', () => {
    expect(() => assertJanelaDoResgate(tx(null), expira, AGORA)).toThrow(/timeBounds|maxTime/);
    expect(() => assertJanelaDoResgate(tx([0, 0]), expira, AGORA)).toThrow(/maxTime/);
    expect(() => assertJanelaDoResgate(tx([0, AGORA + 181]), expira, AGORA)).toThrow(/limite/);
    expect(() => assertJanelaDoResgate(tx([0, AGORA + 170]), new Date((AGORA - 100) * 1000), AGORA)).toThrow(/prazo da cotação/);
    expect(() => assertJanelaDoResgate(tx([AGORA + 60, AGORA + 120]), expira, AGORA)).toThrow(/minTime/);
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
