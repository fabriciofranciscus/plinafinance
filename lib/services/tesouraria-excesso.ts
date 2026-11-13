/**
 * TES-3 — registro do EventoAudit `TESOURARIA_EXCESSO_QUEIMADA` DEPOIS da queima on-chain (Atlas/Consuelo, 13/11).
 *
 * A queima (2.154.540 PLINARF da conta de posição de volta ao issuer) já aconteceu na testnet, executada pelo Farol; aqui só
 * se grava o evento append-only, com o MESMO registro canônico que virou o `Memo.hash` da tx: `payloadHash` = SHA-256 dos
 * bytes exatos do `registroJson` = memo. Como o jsonb reordena as chaves, a string exata fica em `registroCanonico`.
 * Não é MovimentoFundo: o razão do fundo não muda (o ativo não muda; só o supply cai e o NAV por token vai a 1).
 * Leva a nota da Consuelo (condição 2): as carteiras de fora da posição passam a valer mais ao NAV a 1,0 (valor vindo da
 * posição). Sem PII: só quantidades. Idempotente por hash da tx.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface Tes3Queimada {
  /** Hash da tx de queima (64 hex minúsculos). */
  hash: string;
  /** Bytes EXATOS do registro impresso pelo plano (o `Memo.hash` da tx é o SHA-256 deles). */
  registroJson: string;
  /** Memo da tx em hex (opcional): se informado, tem de ser o SHA-256 de `registroJson`. */
  memoHashHex?: string;
  operador: string;
  /** Nota de domínio (Consuelo): carteiras de fora da posição e o valor que o NAV a 1,0 transfere a elas. */
  nota: {
    carteirasForaDaPosicao: number;
    somaForaDaPosicao: string;
    valorTransferidoAproxBrl: string;
  };
}

export class Tes3RegistroError extends Error {
  constructor(
    readonly code: 'HASH_INVALIDO' | 'REGISTRO_INVALIDO' | 'MEMO_DIVERGE' | 'TIPO_INVALIDO' | 'NOTA_INVALIDA',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'Tes3RegistroError';
  }
}

const DECIMAL = /^\d{1,15}(\.\d{1,7})?$/;

export async function registrarTes3Queimada(input: Tes3Queimada): Promise<{ registrado: boolean; payloadHash: string }> {
  if (!/^[0-9a-f]{64}$/.test(input.hash)) {
    throw new Tes3RegistroError('HASH_INVALIDO', 'hash da tx inválido (esperado 64 hex minúsculos)');
  }
  let registro: unknown;
  try {
    registro = JSON.parse(input.registroJson);
  } catch {
    throw new Tes3RegistroError('REGISTRO_INVALIDO', 'registroJson não é um JSON válido');
  }
  if (registro === null || typeof registro !== 'object' || Array.isArray(registro)) {
    throw new Tes3RegistroError('REGISTRO_INVALIDO', 'registroJson deve ser um objeto JSON');
  }
  if ((registro as { tipo?: unknown }).tipo !== 'TES-3') {
    throw new Tes3RegistroError('TIPO_INVALIDO', 'o registro não é de uma TES-3 (tipo diferente de "TES-3")');
  }
  const { carteirasForaDaPosicao: n, somaForaDaPosicao: soma, valorTransferidoAproxBrl: valor } = input.nota;
  if (!Number.isInteger(n) || n < 0 || !DECIMAL.test(soma) || !DECIMAL.test(valor)) {
    throw new Tes3RegistroError('NOTA_INVALIDA', 'nota inválida (inteiro ≥ 0 e decimais sem sinal)');
  }
  const payloadHash = createHash('sha256').update(input.registroJson, 'utf8').digest('hex');
  if (input.memoHashHex !== undefined && input.memoHashHex.toLowerCase() !== payloadHash) {
    throw new Tes3RegistroError('MEMO_DIVERGE', 'o memo da tx não é o SHA-256 do registroJson informado');
  }

  const existente = await db.eventoAudit.findFirst({
    where: { acao: 'TESOURARIA_EXCESSO_QUEIMADA', stellarTxHash: input.hash },
    select: { id: true },
  });
  if (existente) return { registrado: false, payloadHash };

  await db.eventoAudit.create({
    data: {
      acao: 'TESOURARIA_EXCESSO_QUEIMADA',
      operador: input.operador,
      stellarTxHash: input.hash,
      payloadHash,
      payloadJson: {
        registroCanonico: input.registroJson,
        registro: registro as Prisma.InputJsonObject,
        movimentoOnChain: true,
        movimentoFundo: false,
        carteirasForaDaPosicao: n,
        somaForaDaPosicao: soma,
        valorTransferidoAproxBrl: valor,
      } as Prisma.InputJsonValue,
    },
  });
  return { registrado: true, payloadHash };
}
