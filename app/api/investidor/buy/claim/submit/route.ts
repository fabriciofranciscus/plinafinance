/**
 * POST /api/investidor/buy/claim/submit
 *
 * Submete o XDR de `claimClaimableBalance` assinado via Privy. Move TESOURO
 * do ClaimableBalance pra trustline do investor — pré-req pro off-ramp burn
 * funcionar (op_underfunded sem isso).
 *
 * Idempotente: se `OnRampOrder.claimTxHash` já existe, retorna direto.
 *
 * Confere o XDR ANTES de qualquer caminho (fix/claim-submit-verify-xdr; Atlas + Argus): source = investidor
 * autenticado e ops = [changeTrust(ativo do CB, máx)?, claimClaimableBalance(CB da ordem)], nada mais. No caminho
 * "já no ledger" exige `successful` e o efeito `claimable_balance_claimed` do investidor para o CB da ordem.
 * Não confere → 409 fixo, sem submeter e sem evento (o evento CLAIMABLE_BALANCE_RESGATADA só com o claim real).
 * `tx_too_late` → 409 `XDR_EXPIRADO` (o cliente refaz o build). Erro inesperado → 500 fixo.
 *
 * Body: { orderId, xdr, signatureHex }
 * Returns: { claimTxHash, idempotent? }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
} from '@/lib/stellar/transactions';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import {
  ativoDoClaimableBalance,
  claimConfirmadoNaTx,
  conferirEnvelopeClaim,
  erroDeXdrExpirado,
} from '@/lib/stellar/claim';
import { internalErrorResponse } from '@/lib/api/internal-error';

export const dynamic = 'force-dynamic';

/** 409 fixo: o XDR não é o claim desta ordem (nada submetido, nenhum evento). */
function naoConfere(): NextResponse {
  return NextResponse.json(
    { error: 'A transação enviada não é o resgate desta compra. Nada foi registrado.', code: 'XDR_NAO_CONFERE' },
    { status: 409 },
  );
}

const Schema = z
  .object({
    orderId: z.string().min(1).max(60),
    xdr: z.string().min(1).max(8192),
    signatureHex: z.string().min(1).max(256),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { orderId, xdr, signatureHex } = parsed.data;
  try {
    const order = await db.onRampOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'order não encontrada' }, { status: 404 });
    }
    if (order.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'order não pertence ao investidor autenticado' },
        { status: 403 },
      );
    }

    // Idempotência.
    if (order.claimTxHash) {
      return NextResponse.json({
        claimTxHash: order.claimTxHash,
        idempotent: true,
      });
    }

    const balanceId = order.stellarClaimableBalanceId;
    if (!balanceId) {
      return NextResponse.json(
        { error: 'A compra ainda não tem saldo a resgatar.', code: 'CB_AUSENTE' },
        { status: 409 },
      );
    }
    const alvo = { investorPubkey: user.publicKey, balanceId };
    const envelope = conferirEnvelopeClaim(xdr, alvo);
    if (!envelope) return naoConfere();

    // Fecha a janela de crash submit→commit: o hash é determinístico a partir
    // da XDR, então um retry pós-submit (CB já resgatada, hash não persistido)
    // reconcilia pela chain em vez de re-submeter a mesma tx (que daria
    // tx_bad_seq ou resultado confuso). Só vale com sucesso E prova do claim.
    const expectedTxHash = txHashFromXdr(xdr);
    const onchain = await fetchTransactionByHash(expectedTxHash);
    let res: { hash: string };
    if (onchain) {
      if (!onchain.successful) return naoConfere();
      const ativo = await claimConfirmadoNaTx(onchain.hash, alvo);
      if (!ativo) return naoConfere();
      if (envelope.trustAsset && !envelope.trustAsset.equals(ativo)) return naoConfere();
      res = { hash: onchain.hash };
    } else {
      const ativo = await ativoDoClaimableBalance(balanceId);
      if (!ativo) {
        return NextResponse.json(
          { error: 'O saldo a resgatar não está mais disponível.', code: 'CB_NOT_FOUND' },
          { status: 409 },
        );
      }
      if (envelope.trustAsset && !envelope.trustAsset.equals(ativo)) return naoConfere();
      try {
        res = await submitWithPrivySignature({
          xdr,
          investorPubkey: user.publicKey,
          investorSignatureHex: signatureHex,
        });
      } catch (err) {
        // tx_too_late não prova que nenhuma versão entrou: o retry relê pelo hash acima antes de submeter.
        if (erroDeXdrExpirado(err)) {
          return NextResponse.json(
            { error: 'A transação expirou antes de entrar. Gere e assine de novo.', code: 'XDR_EXPIRADO' },
            { status: 409 },
          );
        }
        throw err;
      }
    }

    await db.$transaction(async (tx) => {
      await tx.onRampOrder.update({
        where: { id: order.id },
        data: { claimTxHash: res.hash },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'CLAIMABLE_BALANCE_RESGATADA',
          operador: 'investidor-self-service',
          investidorId: order.investidorId,
          privyId: user.privyId,
          stellarTxHash: res.hash,
          payloadJson: {
            orderId: order.id,
            balanceId: order.stellarClaimableBalanceId,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ claimTxHash: res.hash });
  } catch (err) {
    return internalErrorResponse(err, 'claim/submit');
  }
});
