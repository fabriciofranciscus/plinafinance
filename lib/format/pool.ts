/**
 * Formatadores de EXIBIÇÃO do /pool. Nada aqui calcula: o número chega pronto e só ganha as casas certas.
 * Antes eram dois formatadores de 0 casas dentro da página, e a cota de 5,04 aparecia como "R$ 5 / 5 PLINA-RF".
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Reais com centavos (a coluna do banco é Decimal(15,2)). */
export function brl(value: number): string {
  return BRL.format(value);
}

const TOKEN = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 7 });

/** Quantidade de token: até 7 casas (precisão da Stellar), sem zeros à direita. */
export function tokenFmt(value: number): string {
  return TOKEN.format(value);
}
