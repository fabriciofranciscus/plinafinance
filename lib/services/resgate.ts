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
import { getAssetBalance } from '../stellar/account';
import { caixaDoFundo } from './razao-fundo';
import { escriturarResgate, liberarReservaDoResgate } from './resgate-escrituracao';
import { obterPrecoReferenciaTesouro } from './preco-referencia-tesouro';
import { assertSemSwapEmConferencia } from './swap-orfao';
import {
  COTACAO_RESGATE_TTL_MS,
  amountPlinarfValido,
  assinaturaUnicaDoInvestidor,
  bridgeAmountDoResgate,
  memoHashDoResgate,
  precoNaFaixa,
  tetoResgateBrl,
} from './regras-resgate';

export interface CotarResgateInput {
  investidorId: string;
  investorPubkey: string;
  amountPlinarf: string;
  /** Preço LÍQUIDO do TESOURO em BRL ((fromAmount − fee) ÷ toAmount de uma cotação Etherfuse na hora; a rota calcula). */
  precoTesouroBrl: string;
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

/**
 * Limite de liquidez (Consuelo): o resgate não pode passar do caixa disponível do razão nem do saldo de TESOURO do
 * distributor — sem isso o primeiro a resgatar zera o caixa e quem fica carrega só as cotas. (Teto por janela de
 * liquidez é decisão do CEO, depois.)
 */
async function exigirLiquidez(i: {
  brl: Prisma.Decimal;
  bridge: Prisma.Decimal;
  distributorPubkey: string;
  bridgeAsset: { code: string; issuer: string };
}): Promise<{ saldo: Prisma.Decimal; lidoEm: number }> {
  const caixa = await caixaDoFundo();
  if (i.brl.gt(caixa)) {
    throw new ApiError('LIQUIDEZ_INSUFICIENTE', 409, 'O fundo não tem caixa disponível para este resgate agora. Tente um valor menor.');
  }
  const lidoEm = Date.now();
  const saldo = new Prisma.Decimal(await getAssetBalance(i.distributorPubkey, i.bridgeAsset.code, i.bridgeAsset.issuer));
  if (i.bridge.gt(saldo)) {
    throw new ApiError('LIQUIDEZ_INSUFICIENTE', 409, 'O fundo não tem liquidez disponível para este resgate agora. Tente um valor menor.');
  }
  return { saldo, lidoEm };
}

/** Chave do advisory lock que serializa as reservas de resgate (a checagem de liquidez + a reserva são atômicas). */
export const LOCK_LIQUIDEZ_RESGATE = 'plina:resgate-liquidez';

/**
 * Reserva o resgate JUNTO com a checagem de liquidez, dentro de `pg_advisory_xact_lock` (Atlas, condição de merge):
 * duas cotações simultâneas que passariam cada uma na checagem solta, mas juntas superam o caixa, não passam as duas.
 *   caixa do razão − Σ brlEquivalente dos resgates reservados e ainda não escriturados ≥ este brlEquivalente;
 *   saldo de TESOURO do distributor − Σ bridgeAmount dos reservados (e dos escriturados depois da leitura do saldo,
 *   que a leitura pode ainda não refletir) ≥ este bridgeAmount.
 * Transação curta, SEM rede dentro do lock (o saldo on-chain é lido antes, em `exigirLiquidez`). Devolve quantas linhas
 * reservou (0 = outro request reservou antes). Estouro → `409 LIQUIDEZ_INSUFICIENTE` e nada é reservado.
 */
async function reservarComLiquidez(i: {
  cot: { id: string; brlEquivalente: Prisma.Decimal | string; bridgeAmount: Prisma.Decimal | string };
  saldoTesouro: { saldo: Prisma.Decimal; lidoEm: number };
  dados: Prisma.ResgateCotacaoUpdateManyMutationInput;
}): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_LIQUIDEZ_RESGATE}))`;
    const reservados = await tx.resgateCotacao.aggregate({
      where: { id: { not: i.cot.id }, submitXdrHash: { not: null }, consumedAt: null },
      _sum: { brlEquivalente: true, bridgeAmount: true },
    });
    // Escriturados DEPOIS da leitura do saldo: o pagamento on-chain pode já ter saído e o saldo lido ainda o conter.
    const recentes = await tx.resgateCotacao.aggregate({
      where: { id: { not: i.cot.id }, consumedAt: { gte: new Date(i.saldoTesouro.lidoEm) } },
      _sum: { bridgeAmount: true },
    });
    const caixa = await caixaDoFundo(tx);
    const brl = new Prisma.Decimal(i.cot.brlEquivalente);
    if (brl.gt(caixa.minus(reservados._sum.brlEquivalente ?? 0))) {
      throw new ApiError('LIQUIDEZ_INSUFICIENTE', 409, 'O fundo não tem caixa disponível para este resgate agora. Tente um valor menor.');
    }
    const bridge = new Prisma.Decimal(i.cot.bridgeAmount);
    const comprometido = new Prisma.Decimal(reservados._sum.bridgeAmount ?? 0).plus(recentes._sum.bridgeAmount ?? 0);
    if (bridge.gt(i.saldoTesouro.saldo.minus(comprometido))) {
      throw new ApiError('LIQUIDEZ_INSUFICIENTE', 409, 'O fundo não tem liquidez disponível para este resgate agora. Tente um valor menor.');
    }
    const r = await tx.resgateCotacao.updateMany({ where: { id: i.cot.id, submitXdrHash: null }, data: i.dados });
    return r.count;
  });
}

/**
 * Guardas do preço e do tamanho (Argus R2): (a) o preço da Etherfuse tem de estar a ±2% de uma referência
 * INDEPENDENTE (último swap escriturado ou PRECO_TESOURO_REF_BRL) — sem referência ou fora da faixa, recusa (fail-closed); (b) teto de
 * BRL por resgate. Roda no build e de novo no submit (reserva nova).
 */
async function exigirPrecoETeto(i: { precoTesouroBrl: string | Prisma.Decimal; brl: Prisma.Decimal }): Promise<void> {
  if (i.brl.gt(tetoResgateBrl())) {
    throw new ApiError('RESGATE_ACIMA_DO_TETO', 409, 'Este valor está acima do limite por resgate. Tente um valor menor.');
  }
  const ref = await obterPrecoReferenciaTesouro();
  if (!ref || !precoNaFaixa(i.precoTesouroBrl, ref)) {
    console.error('[resgate] preço do ativo-ponte fora da faixa ou sem referência independente');
    throw new ApiError('PRECO_FORA_DA_FAIXA', 409, 'O preço do ativo-ponte não pôde ser validado agora. Nada foi enviado. Tente novamente mais tarde.');
  }
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
  const bridge = bridgeAmountDoResgate(preco.brlEquivalente, input.precoTesouroBrl);
  if (!bridge) throw new ApiError('ETHERFUSE_ERROR', 502, 'Preço do ativo-ponte indisponível agora. Tente novamente.');
  await exigirPrecoETeto({ precoTesouroBrl: input.precoTesouroBrl, brl: preco.brlEquivalente });

  const { issuerPubkey, distributorPubkey } = chavesStellar();
  await exigirLiquidez({
    brl: preco.brlEquivalente,
    bridge,
    distributorPubkey,
    bridgeAsset: input.bridgeAsset,
  });
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
      // Preço líquido BRL/TESOURO congelado (revalidado no submit, desvio > 1 bp → NAV_MUDOU).
      taxaBridge: new Prisma.Decimal(input.precoTesouroBrl).toString(),
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

export interface SubmeterResgateInput {
  investidor: { id: string; publicKey: string; privyId: string };
  quoteId: string;
  signedXdr: string;
  /** Preço líquido do TESOURO agora (cotação Etherfuse; a rota calcula). Chamado só em reserva NOVA. */
  obterPrecoTesouroBrl: () => Promise<string>;
  agora?: number;
}

/**
 * Idempotência na corrida (Vera F2): dois submits concorrentes do MESMO XDR escrituram uma vez, e o que perde a
 * corrida (erro de concorrência na escrituração, ou o gate do NAV já fechado pela reserva do vencedor) devolve o
 * `txHash` da cotação consumida com este XDR, em vez de um erro. Qualquer outro desfecho propaga o erro original.
 */
export async function submeterResgate(input: SubmeterResgateInput): Promise<{ txHash: string }> {
  try {
    return await submeterResgateInterno(input);
  } catch (err) {
    let xdrHash: string;
    try {
      xdrHash = createHash('sha256').update(new Transaction(input.signedXdr, networkPassphrase).hash()).digest('hex');
    } catch {
      throw err;
    }
    const cot = await db.resgateCotacao.findUnique({
      where: { id: input.quoteId },
      select: { investidorId: true, submitXdrHash: true, consumedAt: true, consumedTxHash: true },
    });
    if (cot && cot.investidorId === input.investidor.id && cot.consumedAt && cot.consumedTxHash && cot.submitXdrHash === xdrHash) {
      return { txHash: cot.consumedTxHash };
    }
    throw err;
  }
}

async function submeterResgateInterno(input: SubmeterResgateInput): Promise<{ txHash: string }> {
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
      // Janela de validade (Estela, 9d685e0): maxTime ≤ agora+180 s e ≤ prazo da cotação + 120 s.
      quoteExpiresAt: cot.expiresAt,
    }, { agoraSec });
  } catch (err) {
    throw new ApiError('VALIDATION_FAILED', 400, `xdr divergente da cotação: ${err instanceof Error ? err.message : 'erro'}`);
  }

  // NAV relido só em reserva NOVA (numa órfã a tx pode já estar no ledger e o NAV de agora já a reflete).
  let saldoTesouro: { saldo: Prisma.Decimal; lidoEm: number } | null = null;
  if (!orfa) {
    const atual = await calcularPrecoDeResgate({ amountPlinarf: new Prisma.Decimal(cot.plinarfAmount).toFixed(7) });
    if (navMudou(cot.navPorTokenNaCotacao, atual.navPorToken)) {
      throw new ApiError('NAV_MUDOU', 409, 'O NAV mudou desde a cotação. Gere uma nova cotação.');
    }
    // O preço do TESOURO (mesma fonte da cotação) também não pode ter andado além de 1 bp.
    const precoAgora = await input.obterPrecoTesouroBrl();
    if (navMudou(cot.taxaBridge, precoAgora)) {
      throw new ApiError('NAV_MUDOU', 409, 'O preço mudou desde a cotação. Gere uma nova cotação.');
    }
    // Preço atual também na faixa da referência independente, e o teto (pode ter mudado desde a cotação).
    await exigirPrecoETeto({ precoTesouroBrl: precoAgora, brl: new Prisma.Decimal(cot.brlEquivalente) });
    // Liquidez relida (outras operações podem ter consumido o caixa desde a cotação). A checagem DEFINITIVA, junto com
    // a reserva e sob lock, é `reservarComLiquidez` abaixo (cotações simultâneas).
    saldoTesouro = await exigirLiquidez({
      brl: new Prisma.Decimal(cot.brlEquivalente),
      bridge: new Prisma.Decimal(cot.bridgeAmount),
      distributorPubkey,
      bridgeAsset: { code: cot.bridgeCode, issuer: cot.bridgeIssuer },
    });
    // Reserva nova com outro swap/resgate do MESMO investidor em conferência: recusa.
    await assertSemSwapEmConferencia(investidor.id, { ignorarResgateId: cot.id });
  }

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  const txHashHex = tx.hash().toString('hex');
  const dadosReserva = {
    submitXdrHash: xdrHash,
    submitTxHash: txHashHex,
    submitMaxTime: maxTime > 0 ? new Date(maxTime * 1000) : null,
    submitXdr: signedXdr,
  };
  // Reserva NOVA: sob o lock de liquidez (a checagem e a reserva são atômicas). Órfã: já reservada, sem checagem nova.
  const reserved = {
    count: saldoTesouro
      ? await reservarComLiquidez({ cot, saldoTesouro, dados: dadosReserva })
      : (await db.resgateCotacao.updateMany({ where: { id: cot.id, submitXdrHash: null }, data: dadosReserva })).count,
  };
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
