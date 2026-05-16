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

import { Prisma } from '@prisma/client';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { db } from '../db';
import { assetCode, networkPassphrase } from '../stellar/config';
import { buildAsset, horizon } from '../stellar/account';
import { privySignatureToBase64 } from '../wallet/privy';
import {
  buildAuditPayload,
  registerOnChainHash,
} from '../stellar/audit';
import { navPorToken, navTotalDoPool, tokensEmitidosVivos } from './pool';

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
  const cotas = await db.cota.findMany({
    where: { status: { in: ['DISPONIVEL', 'RESERVADA'] } },
    select: {
      valorCarta: true,
      desagioAquisicao: true,
      tokensEmitidos: true,
      status: true,
    },
  });
  const navTotal = navTotalDoPool(cotas);
  const tokensVivos = tokensEmitidosVivos(cotas);
  const unit = navPorToken(cotas);
  return {
    amountPlinarf: amount,
    navPorTokenAtual: unit,
    brlEquivalente: amount * unit,
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
  const amount = Number(input.amount);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error('amount inválido');
  }
  const stellarAmount = amount.toFixed(7);

  const account = await horizon.loadAccount(input.investorPubkey);
  const plinarf: Asset = buildAsset(issuerPubkey, assetCode);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: distributorPubkey,
        asset: plinarf,
        amount: stellarAmount,
      }),
    )
    .setTimeout(60)
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
  amount: string;
  investidorId?: string;
}): Promise<{
  liquidationTxHash: string;
  auditTxHash: string;
  brlEquivalente: number;
  navPorTokenAtual: number;
}> {
  const amount = Number(input.amount);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error('amount inválido');
  }
  const stellarAmount = amount.toFixed(7);

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

  // 4) Persist + audit log + saldoEsperado decrement.
  if (input.investidorId) {
    await db.$transaction(async (tx) => {
      await tx.eventoAudit.create({
        data: {
          acao: 'PLINARF_LIQUIDADO',
          operador: 'investidor-self-service',
          investidorId: input.investidorId,
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
    });
  }

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
