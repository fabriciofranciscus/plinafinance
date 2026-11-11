/**
 * Resgate com queima (E2-6; contrato contratos/2026-11-11-e2-4-resgate-api.md).
 *
 * `cotarResgate` (build): preço ao NAV do ledger + TESOURO a pagar, persiste a cotação e devolve o XDR de 2 pernas
 * (investidor → issuer queima PLINARF; distributor → investidor paga TESOURO) SEM assinatura da Plina.
 * `submeterResgate` (submit): confere o XDR contra a cotação, reserva (hash único) e SÓ ENTÃO a Plina (distributor)
 * assina e submete; o domínio (RESGATE_PAGO) é gravado DEPOIS da chain. Reserva órfã: a Plina só re-assina antes do
 * `maxTime` do envelope e nunca libera por "não achei" (mesma regra do swap, N1-S1).
 */

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Asset, Transaction } from '@stellar/stellar-sdk';
import { db } from '../db';
import { ApiError } from '../api/errors';
import { networkPassphrase } from '../stellar/config';
import { assertResgateXdrMatchesQuote, buildResgateXdr } from '../stellar/resgate';
import { fetchTransactionByHash, preSignWithSigner, submitWithPrivySignature } from '../stellar/transactions';
import { distributorSigner } from '../stellar/signer';
import { assetCodeForClasse } from '../stellar/classes';
import { calcularPrecoDeResgate } from './liquidacao';
import { navMudou } from './pool';
import { decrementarHolding } from './holdings';
import { registrarMovimentoFundo } from './razao-fundo';
import { assertSemSwapEmConferencia } from './swap-orfao';
import {
  COTACAO_RESGATE_TTL_MS,
  amountPlinarfValido,
  assertJanelaDoResgate,
  assinaturaUnicaDoInvestidor,
  bridgeAmountDoResgate,
  memoHashDoResgate,
} from './regras-resgate';

export interface CotarResgateInput {
  investidorId: string;
  investorPubkey: string;
  amountPlinarf: string;
  /** Taxa BRL→TESOURO (exchangeRate de uma cotação Etherfuse feita pela rota; só fonte de preço). */
  taxaBrlParaBridge: string;
  bridgeAsset: { code: string; issuer: string };
  agora?: number;
}

export interface CotacaoDeResgate {
  quoteId: string;
  xdr: string;
  hashHex: string;
  amountPlinarf: string;
  brlEquivalente: string;
  navPorTokenNaCotacao: string;
  expiresAt: string;
}

function chavesStellar(): { issuerPubkey: string; distributorPubkey: string } {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) throw new Error('Stellar issuer/distributor não configurados.');
  return { issuerPubkey, distributorPubkey };
}

export async function cotarResgate(input: CotarResgateInput): Promise<CotacaoDeResgate> {
  const amount = amountPlinarfValido(input.amountPlinarf);
  if (!amount) throw new ApiError('VALIDATION_FAILED', 400, 'amountPlinarf inválido: decimal > 0 com até 7 casas.');
  // Sem cotação nova com swap/resgate do investidor em conferência (reserva órfã).
  await assertSemSwapEmConferencia(input.investidorId);

  const preco = await calcularPrecoDeResgate({ amountPlinarf: amount.toFixed(7) }); // NavIndisponivelError → 503 na rota
  if (!preco.brlEquivalente.gt(0)) {
    throw new ApiError('VALIDATION_FAILED', 400, 'Quantidade pequena demais: o valor em BRL arredonda para zero.');
  }
  const bridge = bridgeAmountDoResgate(preco.brlEquivalente, input.taxaBrlParaBridge);
  if (!bridge) throw new ApiError('ETHERFUSE_ERROR', 502, 'Taxa de conversão indisponível agora. Tente novamente.');

  const { issuerPubkey, distributorPubkey } = chavesStellar();
  const quoteId = randomUUID();
  const built = await buildResgateXdr({
    investorPubkey: input.investorPubkey,
    issuerPubkey,
    distributorPubkey,
    bridgeAsset: new Asset(input.bridgeAsset.code, input.bridgeAsset.issuer),
    plinarfCode: assetCodeForClasse('SENIOR'),
    plinarfAmount: amount.toFixed(7),
    bridgeAmount: bridge.toFixed(7),
    memoHash: memoHashDoResgate(quoteId),
  });
  const expiresAt = new Date((input.agora ?? Date.now()) + COTACAO_RESGATE_TTL_MS);
  await db.resgateCotacao.create({
    data: {
      id: quoteId,
      investidorId: input.investidorId,
      classe: 'SENIOR',
      plinarfAmount: amount,
      brlEquivalente: preco.brlEquivalente,
      bridgeAmount: bridge,
      taxaBridge: input.taxaBrlParaBridge,
      bridgeCode: input.bridgeAsset.code,
      bridgeIssuer: input.bridgeAsset.issuer,
      navPorTokenNaCotacao: preco.navPorToken,
      expiresAt,
    },
  });
  return {
    quoteId,
    xdr: built.xdr,
    hashHex: built.hashHex,
    amountPlinarf: amount.toFixed(7),
    brlEquivalente: preco.brlEquivalente.toFixed(2),
    navPorTokenNaCotacao: preco.navPorToken.toFixed(8),
    expiresAt: expiresAt.toISOString(),
  };
}

type CotacaoRow = NonNullable<Awaited<ReturnType<typeof db.resgateCotacao.findFirst>>>;

/** Commit de domínio DEPOIS da chain (usado pelo submit e, depois, pelo reconciliador de órfãs). */
export async function escriturarResgate(input: {
  cotacao: Pick<CotacaoRow, 'id' | 'investidorId' | 'classe' | 'plinarfAmount' | 'brlEquivalente' | 'bridgeAmount' | 'navPorTokenNaCotacao'>;
  finalHash: string;
  privyId?: string | null;
  operador?: string;
}): Promise<void> {
  const { cotacao: c, finalHash } = input;
  const tokens = new Prisma.Decimal(c.plinarfAmount).toFixed(7);
  await db.$transaction(async (tx) => {
    const consumed = await tx.resgateCotacao.updateMany({
      where: { id: c.id, consumedAt: null },
      data: { consumedAt: new Date(), consumedTxHash: finalHash },
    });
    if (consumed.count !== 1) throw new Error('cotação de resgate consumida concorrentemente — abortando');
    // Caixa −V e tokens −q (RESGATE_PAGO): o supply já caiu na chain (queima) e o caixa sai aqui, juntos.
    await registrarMovimentoFundo(tx, {
      tipo: 'RESGATE_PAGO',
      valorBrl: c.brlEquivalente,
      tokens,
      chave: `resgate:${c.id}`,
      refHash: finalHash,
      txHash: finalHash,
      navPorToken: c.navPorTokenNaCotacao,
    });
    await decrementarHolding(tx, {
      investidorId: c.investidorId,
      classe: c.classe,
      amount: tokens,
      txHash: finalHash,
    });
    await tx.investidor.update({
      where: { id: c.investidorId },
      data: { saldoEsperado: { decrement: new Prisma.Decimal(tokens) } },
    });
    await tx.eventoAudit.create({
      data: {
        acao: 'PLINARF_LIQUIDADO',
        operador: input.operador ?? 'investidor-self-service',
        investidorId: c.investidorId,
        privyId: input.privyId ?? null,
        stellarTxHash: finalHash,
        payloadJson: {
          quoteId: c.id,
          amountPlinarf: tokens,
          brlEquivalente: new Prisma.Decimal(c.brlEquivalente).toFixed(2),
          bridgeAmount: new Prisma.Decimal(c.bridgeAmount).toFixed(7),
          navPorToken: new Prisma.Decimal(c.navPorTokenNaCotacao).toFixed(8),
          queima: true,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

/** Libera a reserva (só desta XDR e só enquanto não consumida). */
export function liberarReservaDoResgate(quoteId: string, xdrHash: string) {
  return db.resgateCotacao.updateMany({
    where: { id: quoteId, submitXdrHash: xdrHash, consumedAt: null },
    data: { submitXdrHash: null, submitTxHash: null, submitMaxTime: null, submitXdr: null },
  });
}

export interface SubmeterResgateInput {
  investidor: { id: string; publicKey: string; privyId: string };
  quoteId: string;
  signedXdr: string;
  agora?: number;
}

export async function submeterResgate(input: SubmeterResgateInput): Promise<{ txHash: string }> {
  const { investidor, quoteId, signedXdr } = input;
  const agoraMs = input.agora ?? Date.now();
  const agoraSec = Math.floor(agoraMs / 1000);

  let tx: Transaction;
  try {
    tx = new Transaction(signedXdr, networkPassphrase);
  } catch {
    throw new ApiError('VALIDATION_FAILED', 400, 'xdr inválida');
  }
  const investorSig = assinaturaUnicaDoInvestidor(tx, investidor.publicKey);
  if (!investorSig) throw new ApiError('VALIDATION_FAILED', 400, 'assinatura do investidor ausente ou inválida');

  // Ownership: a cotação é do investidor da sessão; senão é como se não existisse.
  const cot = await db.resgateCotacao.findFirst({ where: { id: quoteId, investidorId: investidor.id } });
  if (!cot) throw new ApiError('NOT_FOUND', 404, 'cotação não encontrada');

  const xdrHash = createHash('sha256').update(tx.hash()).digest('hex');
  if (cot.consumedAt) {
    if (cot.submitXdrHash === xdrHash && cot.consumedTxHash) return { txHash: cot.consumedTxHash }; // idempotente
    throw new ApiError('CONFLICT', 409, 'cotação já consumida');
  }
  const orfa = !!cot.submitXdrHash;
  if (orfa && cot.submitXdrHash !== xdrHash) {
    throw new ApiError('CONFLICT', 409, 'cotação já em submissão com outro XDR');
  }
  if (!orfa && cot.expiresAt.getTime() <= agoraMs) {
    throw new ApiError('COTACAO_EXPIRADA', 410, 'A cotação do resgate expirou. Gere uma nova.');
  }

  const { issuerPubkey, distributorPubkey } = chavesStellar();
  try {
    assertResgateXdrMatchesQuote(signedXdr, {
      investorPubkey: investidor.publicKey,
      issuerPubkey,
      distributorPubkey,
      bridgeAsset: { code: cot.bridgeCode, issuer: cot.bridgeIssuer },
      plinarfCode: assetCodeForClasse('SENIOR'),
      expectedPlinarfAmount: new Prisma.Decimal(cot.plinarfAmount).toFixed(7),
      expectedBridgeAmount: new Prisma.Decimal(cot.bridgeAmount).toFixed(7),
      memoHash: memoHashDoResgate(cot.id),
    });
    assertJanelaDoResgate(tx, cot.expiresAt, agoraSec);
  } catch (err) {
    throw new ApiError('VALIDATION_FAILED', 400, `xdr divergente da cotação: ${err instanceof Error ? err.message : 'erro'}`);
  }

  // NAV relido só em reserva NOVA (numa órfã a tx pode já estar no ledger e o NAV de agora já a reflete).
  if (!orfa) {
    const atual = await calcularPrecoDeResgate({ amountPlinarf: new Prisma.Decimal(cot.plinarfAmount).toFixed(7) });
    if (navMudou(cot.navPorTokenNaCotacao, atual.navPorToken)) {
      throw new ApiError('NAV_MUDOU', 409, 'O NAV mudou desde a cotação. Gere uma nova cotação.');
    }
    // Reserva nova com outro swap/resgate do MESMO investidor em conferência: recusa.
    await assertSemSwapEmConferencia(investidor.id, { ignorarResgateId: cot.id });
  }

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  const txHashHex = tx.hash().toString('hex');
  const reserved = await db.resgateCotacao.updateMany({
    where: { id: cot.id, submitXdrHash: null },
    data: {
      submitXdrHash: xdrHash,
      submitTxHash: txHashHex,
      submitMaxTime: maxTime > 0 ? new Date(maxTime * 1000) : null,
      submitXdr: signedXdr,
    },
  });
  if (reserved.count !== 1 && !orfa) {
    // Perdeu a corrida: outro request reservou nesse meio-tempo.
    const fresh = await db.resgateCotacao.findUnique({ where: { id: cot.id }, select: { submitXdrHash: true } });
    if (fresh?.submitXdrHash !== xdrHash) throw new ApiError('CONFLICT', 409, 'cotação já em submissão com outro XDR');
  }

  const onchain = reserved.count === 1 ? null : await fetchTransactionByHash(txHashHex);
  let finalHash: string;
  if (onchain?.successful) {
    finalHash = onchain.hash;
  } else if (onchain) {
    await liberarReservaDoResgate(cot.id, xdrHash); // entrou e falhou on-chain: prova positiva
    throw new ApiError('CONFLICT', 409, 'a transação anterior falhou na rede — refaça o resgate');
  } else {
    if (reserved.count !== 1 && (!maxTime || agoraSec > maxTime)) {
      // Órfã fora da chain depois do prazo: a Plina NUNCA assina de novo e NÃO libera por "não achei".
      throw new ApiError('COTACAO_EXPIRADA', 410, 'envelope expirado — a conferência na rede é feita pela operação');
    }
    const distSig = preSignWithSigner(distributorSigner(), signedXdr);
    if (distSig.pubkey !== distributorPubkey) throw new Error('signer do distributor diverge da configuração');
    const unsigned = new Transaction(signedXdr, networkPassphrase);
    unsigned.signatures.length = 0;
    const res = await submitWithPrivySignature({
      xdr: unsigned.toXDR(),
      investorPubkey: investidor.publicKey,
      investorSignatureHex: `0x${investorSig.toString('hex')}`,
      extraSignatures: [{ pubkey: distSig.pubkey, sigBase64: distSig.sigBase64 }],
    });
    finalHash = res.hash;
  }

  await escriturarResgate({ cotacao: cot, finalHash, privyId: investidor.privyId });
  return { txHash: finalHash };
}
