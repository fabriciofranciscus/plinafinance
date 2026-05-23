/**
 * Liquidação service — investidor vende PLINARF de volta pro distributor.
 *
 * Whitepaper §6.4 — "janelas periódicas de liquidez via claimable balance".
 * MVP testnet implementa o caminho mais simples (venda direta com BRL
 * simulado), preservando a economia: NAV por token = (NAV total do pool) /
 * (tokens vivos). Investidor recebe `amount × NAV/token` em BRL fictício.
 *
 * Fluxo on-chain (3 txs):
 *   1. Investor → Distributor: payment de PLINARF (assinado via Privy).
 *   2. Issuer: clawback (ou null se preferirmos NÃO queimar — POC mantém
 *      no distributor pra revenda futura, mantendo total emitido estável).
 *   3. Audit on-chain do hash da liquidação.
 *
 * Decisão MVP: NÃO queima. PLINARF volta pro distributor disponível pra
 * próxima rodada de captação. Mais limpo arquiteturalmente.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { db } from '../db';
import {
  STELLAR_TX_TIMEOUT_SEC,
  assetCode,
  networkPassphrase,
} from '../stellar/config';
import { buildAsset, horizon } from '../stellar/account';
import { getDynamicFee } from '../stellar/fee';
import { privySignatureToBase64 } from '../wallet/privy';
import { parseStellarAmount } from '../format/parse-stellar-amount';
import { extractLiquidacaoAmount } from '../stellar/parse-liquidacao-xdr';
import {
  buildAuditPayload,
  registerOnChainHash,
} from '../stellar/audit';
import {
  navPorToken,
  navPorTokenAsDecimal,
  navTotalDoPool,
  tokensEmitidosVivos,
} from './pool';

export interface CalcularLiquidacaoInput {
  amountPlinarf: string;
}

export interface CalcularLiquidacaoResult {
  amountPlinarf: number;
  navPorTokenAtual: number;
  brlEquivalente: number;
  navTotalPool: number;
  tokensVivosPool: number;
}

/**
 * Calcula BRL simulado equivalente a uma quantidade de PLINA-RF a NAV
 * atual. NAV/token = NAV total / tokens vivos.
 */
export async function calcularValorLiquidacao(
  input: CalcularLiquidacaoInput,
): Promise<CalcularLiquidacaoResult> {
  const amount = Number(input.amountPlinarf);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error('amountPlinarf inválido');
  }
  const [cotas, realizacoes] = await Promise.all([
    db.cota.findMany({
      where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
      select: {
        valorCarta: true,
        desagioAquisicao: true,
        tokensEmitidos: true,
        status: true,
      },
    }),
    db.realizacaoCaminho.findMany({
      select: { valorRealizado: true, spread: true },
    }),
  ]);
  const navTotal = navTotalDoPool(cotas, realizacoes);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const unitDec = navPorTokenAsDecimal(cotas, realizacoes);
  const brlEquivalenteDec = unitDec
    .mul(new Prisma.Decimal(input.amountPlinarf))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
  return {
    amountPlinarf: amount,
    navPorTokenAtual: unitDec.toNumber(),
    brlEquivalente: brlEquivalenteDec.toNumber(),
    navTotalPool: navTotal,
    tokensVivosPool: tokensVivos,
  };
}

/**
 * Monta XDR pro investidor pagar `amount` PLINARF ao distributor.
 * Investor assina via Privy rawSign no client; backend submete.
 */
export async function buildLiquidarPlinarfXdr(input: {
  investorPubkey: string;
  amount: string;
}): Promise<{ xdr: string; hashHex: string }> {
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) {
    throw new Error('Stellar issuer/distributor não configurados.');
  }
  const stellarAmount = parseStellarAmount(input.amount).toFixed(7);

  const account = await horizon.loadAccount(input.investorPubkey);
  const plinarf: Asset = buildAsset(issuerPubkey, assetCode);

  const tx = new TransactionBuilder(account, {
    fee: await getDynamicFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: distributorPubkey,
        asset: plinarf,
        amount: stellarAmount,
      }),
    )
    .setTimeout(STELLAR_TX_TIMEOUT_SEC)
    .build();

  return { xdr: tx.toXDR(), hashHex: '0x' + tx.hash().toString('hex') };
}

/**
 * Submete tx assinada pelo investidor (via Privy rawSign). Após sucesso:
 *   - Atualiza Investidor.saldoEsperado (decrement)
 *   - Cria EventoAudit PLINARF_LIQUIDADO com hash on-chain do payload
 *     (incluindo NAV/token usado, BRL equivalente, etc).
 *
 * BRL é simulado — no MVP testnet não há TED real. Em mainnet futuro,
 * adapter Pix-out (Celcoin) executa o desembolso paralelo.
 */
export async function submitLiquidacao(input: {
  xdr: string;
  investorPubkey: string;
  signatureHex: string;
  /** @deprecated mantido pra retrocompat; amount autoritativo vem do XDR (C-03). */
  amount?: string;
  investidorId: string;
  privyId: string;
}): Promise<{
  liquidationTxHash: string;
  auditTxHash: string;
  brlEquivalente: number;
  navPorTokenAtual: number;
}> {
  // C-03: amount autoritativo vem da própria XDR assinada — não do body.
  // Body podia divergir do que o investor realmente assinou; chain processa
  // o XDR, DB decrementava o body, gap "perdido" no saldo.
  const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
  const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
  if (!issuerPubkey || !distributorPubkey) {
    throw new Error('Stellar issuer/distributor não configurados.');
  }
  const xdrAmount = extractLiquidacaoAmount(input.xdr, {
    investorPubkey: input.investorPubkey,
    distributorPubkey,
    issuerPubkey,
  });
  const stellarAmount = parseStellarAmount(xdrAmount).toFixed(7);

  // C-04: idempotência. xdrHash unique → P2002 em retry; tabela própria
  // (liquidação não tem Quote persistido). Reserve antes do submit; se
  // já existe e tem txHash, retorna sem re-submeter.
  const xdrHash = createHash('sha256').update(input.xdr).digest('hex');
  try {
    await db.liquidacaoSubmit.create({
      data: { xdrHash, investidorId: input.investidorId },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await db.liquidacaoSubmit.findUnique({
        where: { xdrHash },
        select: { txHash: true, investidorId: true },
      });
      if (existing?.investidorId !== input.investidorId) {
        throw new Error('xdr já reservada por outro investidor');
      }
      if (existing.txHash) {
        const auditExisting = await db.eventoAudit.findFirst({
          where: {
            acao: 'PLINARF_LIQUIDADO',
            investidorId: input.investidorId,
            payloadJson: {
              path: ['liquidationTxHash'],
              equals: existing.txHash,
            },
          },
          select: { stellarTxHash: true, payloadJson: true },
        });
        const payload = auditExisting?.payloadJson as
          | { brlEquivalente?: number; navPorTokenAtual?: number }
          | null;
        return {
          liquidationTxHash: existing.txHash,
          auditTxHash: auditExisting?.stellarTxHash ?? existing.txHash,
          brlEquivalente: payload?.brlEquivalente ?? 0,
          navPorTokenAtual: payload?.navPorTokenAtual ?? 0,
        };
      }
      throw new Error('liquidação já em flight pra esse XDR');
    }
    throw err;
  }

  // 1) Calcula NAV/token ANTES de submeter (preço justo da liquidação).
  const valor = await calcularValorLiquidacao({ amountPlinarf: stellarAmount });

  // 2) Submete payment Investidor → Distributor (Privy signature).
  const tx = new Transaction(input.xdr, networkPassphrase);
  tx.addSignature(
    input.investorPubkey,
    privySignatureToBase64(input.signatureHex),
  );
  const submitRes = await (
    horizon as Horizon.Server
  ).submitTransaction(tx);
  const liquidationTxHash = submitRes.hash;

  // 3) Audit on-chain do hash da liquidação (Memo.hash da Plina assinando
  //    o ato — não confunde com a tx do payment do investidor).
  const payload = buildAuditPayload(
    'plinarf_liquidado',
    input.investidorId,
    {
      investorPubkey: input.investorPubkey,
      amountPlinarf: stellarAmount,
      navPorTokenAtual: valor.navPorTokenAtual,
      brlEquivalente: valor.brlEquivalente,
      liquidationTxHash,
    },
  );
  const onChain = await registerOnChainHash(payload);

  // 4) Persist + audit log + saldoEsperado decrement. investidorId é
  // required agora (vem do auth-guard), então grava incondicionalmente.
  await db.$transaction(async (tx) => {
    await tx.eventoAudit.create({
      data: {
        acao: 'PLINARF_LIQUIDADO',
        operador: 'investidor-self-service',
        investidorId: input.investidorId,
        privyId: input.privyId,
        stellarTxHash: onChain.txHash,
        payloadHash: onChain.payloadHash,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.investidor.update({
      where: { id: input.investidorId },
      data: {
        saldoEsperado: {
          decrement: new Prisma.Decimal(stellarAmount),
        },
      },
    });
    await tx.liquidacaoSubmit.update({
      where: { xdrHash },
      data: { txHash: liquidationTxHash },
    });
  });

  return {
    liquidationTxHash,
    auditTxHash: onChain.txHash,
    brlEquivalente: valor.brlEquivalente,
    navPorTokenAtual: valor.navPorTokenAtual,
  };
}

/**
 * Pre-sign de uma tx com a chave do distributor (não usado no flow atual,
 * mas pode ser útil pra fluxos futuros que exijam co-assinatura).
 */
export function preSignDistributor(xdr: string): {
  pubkey: string;
  sigBase64: string;
} {
  const secret = process.env.STELLAR_DISTRIBUTOR_SECRET;
  if (!secret) throw new Error('STELLAR_DISTRIBUTOR_SECRET ausente');
  const kp = Keypair.fromSecret(secret);
  const tx = new Transaction(xdr, networkPassphrase);
  const sigBytes = kp.sign(tx.hash());
  return { pubkey: kp.publicKey(), sigBase64: sigBytes.toString('base64') };
}

// Memo import keeper (unused but pre-imported pra adicionar Memo.text futuro).
void Memo;
