/**
 * Validadores de valor com o limite da COLUNA do banco / do ativo, nunca uma regra de negócio inventada (auditoria de input,
 * I3; o bug do `step="1000"` veio de regra que o servidor nunca teve). Mensagens fixas: não repetem o valor enviado.
 *
 *   - ValorBrlString          Decimal(15,2) (prisma/schema.prisma: Oferta/Cota.valorCarta): até 13 inteiros e 2 casas.
 *   - DesagioColunaString     Decimal(5,4): só o FORMATO da coluna (1 inteiro, até 4 casas). A faixa [0, 1] fica no serviço, que
 *                             responde 422 com `code` ao operador (A-22): não duplicar aqui, senão a tela perde o código.
 *   - FracaoDesagioString     formato + faixa [0, 1] na própria rota, para campos sem checagem de faixa no serviço (desagioRevenda).
 *   - QuantidadeStellarString ativo Stellar: até 12 inteiros e 7 casas, > 0 (o mesmo regex de liquidar/build).
 *
 * Só formato e limite: regras de negócio (valor > 0, deságio total ≤ 100% etc.) continuam nos serviços.
 */
import { z } from 'zod';

const REGEX_BRL = /^\d{1,13}(\.\d{1,2})?$/;
const REGEX_FRACAO = /^\d(\.\d{1,4})?$/;
const REGEX_STELLAR = /^\d{1,12}(\.\d{1,7})?$/;

export const ValorBrlString = z
  .string()
  .regex(REGEX_BRL, 'valor em reais inválido: use ponto como separador decimal, ex.: 250000.00, com até 13 inteiros e 2 casas');

export const DesagioColunaString = z
  .string()
  .regex(REGEX_FRACAO, 'deságio inválido: use uma fração entre 0 e 1 com até 4 casas, ex.: 0.20 para 20%; não omita o zero inicial');

export const FracaoDesagioString = z
  .string()
  .regex(REGEX_FRACAO, 'deságio inválido: use uma fração entre 0 e 1 com até 4 casas (ex.: 0.20 para 20%)')
  .refine((v) => Number(v) <= 1, 'deságio inválido: use uma fração entre 0 e 1 com até 4 casas (ex.: 0.20 para 20%)');

export const QuantidadeStellarString = z
  .string()
  .regex(REGEX_STELLAR, 'quantidade inválida: use só dígitos, com até 12 inteiros e 7 casas decimais')
  .refine((v) => Number(v) > 0, 'quantidade deve ser maior que zero');

/** Para checagens fora do Zod (ex.: dentro de um handler que já tem o texto). */
export const formatoQuantidadeStellarValido = (v: unknown): v is string =>
  typeof v === 'string' && REGEX_STELLAR.test(v) && Number(v) > 0;
