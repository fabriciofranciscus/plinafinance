/**
 * POST /api/investidor/buy/swap/submit
 *
 * Recebe o envelope do swap (TESOURO → distributor + PLINARF issuer →
 * investor) JÁ assinado pelo investidor. A Plina só assina AQUI (N1, L1-S1/S3):
 * valida o XDR contra o quote e contra as chaves do env, relê o NAV (L1-S2) e só
 * então acrescenta a assinatura do issuer e submete a tx atômica. Qualquer
 * divergência dá 4xx, sem assinar e sem gastar fee.
 *
 * Marca o quote como consumido dentro da mesma db.$transaction do audit log.
 * Modo mock é tratado em /swap/build — esta rota só aceita real.
 *
 * Body: { quoteId, signedXdr } — o investidor vem da sessão; issuer e
 * distributor vêm só do env, nunca do body.
 * Returns: { swapTxHash } | 409 { code: 'NAV_MUDOU' } quando o NAV divergiu da cotação.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Keypair, Transaction } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@/lib/stellar/config';
import { db } from '@/lib/db';
import {
  preSignWithSigner,
  submitWithPrivySignature,
  txHashFromXdr,
  fetchTransactionByHash,
} from '@/lib/stellar/transactions';
import { TrustlineNaoAutorizadaError, exigirEmissoesParaTrustlineAutorizada } from '@/lib/stellar/trustline';
import { issuerSigner } from '@/lib/stellar/signer';
import { getDynamicFee } from '@/lib/stellar/fee';
import { NavMudouError, revalidarNavDaCotacao } from '@/lib/services/emissao';
import { assertClasseDisponivel } from '@/lib/services/regras-swap';
import { escriturarSwap, liberarReservaDoSwap } from '@/lib/services/swap-escrituracao';
import { assertSemSwapEmConferencia } from '@/lib/services/swap-orfao';
import { ApiError } from '@/lib/api/errors';
import { navUnavailableResponse } from '@/lib/api/nav-unavailable';
import { assertElegivelParaTrustline } from '@/lib/services/investidor';
import { withAuth } from '@/lib/wallet/auth-guard';
import { extractSafeError, logStellarError } from '@/lib/stellar/log-error';
import { parseBody } from '@/lib/http/parse-body';
import { stellarXdr } from '@/lib/http/zod-stellar';
import { parseStellarAmount } from '@/lib/format/parse-stellar-amount';
import { registrarMovimentoFundo } from '@/lib/services/razao-fundo';
import { assertSwapXdrMatchesQuote } from '@/lib/stellar/parse-swap-xdr';
import { assetCodeForClasse, classeOrDefault } from '@/lib/stellar/classes';
import { incrementarHolding } from '@/lib/services/holdings';
import { resolveTesouroAsset } from '@/lib/anchors/etherfuse/tesouro';

export const dynamic = 'force-dynamic';


/**
 * Assinatura do investidor no envelope: exatamente UMA assinatura, com o hint da
 * chave dele e válida sobre o hash da tx. Devolve os 64 bytes ou `null`.
 * (Verificado aqui, antes de a Plina assinar; a rede verificaria depois.)
 */
function investorSignature(tx: Transaction, investorPubkey: string): Buffer | null {
  if (tx.signatures.length !== 1) return null;
  const sig = tx.signatures[0];
  try {
    const kp = Keypair.fromPublicKey(investorPubkey);
    if (!sig.hint().equals(kp.signatureHint())) return null;
    const raw = sig.signature();
    return kp.verify(tx.hash(), raw) ? Buffer.from(raw) : null;
  } catch {
    return null;
  }
}

const Schema = z
  .object({
    quoteId: z.string().min(1).max(60),
    signedXdr: stellarXdr(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const { quoteId, signedXdr } = parsed.data;
  // O investidor é o da sessão — o body não escolhe quem paga nem quem recebe.
  const investorPubkey = user.publicKey;
  try {
    let signedTx: Transaction;
    try {
      signedTx = new Transaction(signedXdr, networkPassphrase);
    } catch {
      return NextResponse.json({ error: 'xdr inválida' }, { status: 400 });
    }
    const investorSig = investorSignature(signedTx, investorPubkey);
    if (!investorSig) {
      return NextResponse.json(
        { error: 'assinatura do investidor ausente ou inválida' },
        { status: 400 },
      );
    }

    const quote = await db.quote.findUnique({
      where: { id: quoteId },
      include: { investidor: true, onRampOrder: true },
    });
    if (!quote) {
      return NextResponse.json({ error: 'quote não encontrado' }, { status: 404 });
    }
    if (quote.investidorId !== user.investidorId) {
      return NextResponse.json(
        { error: 'quote pertence a outro investidor' },
        { status: 403 },
      );
    }
    // C-04: idempotência. xdrHash reserva a request; retry com mesmo XDR
    // após sucesso retorna hash existente, com XDR diferente em quote já
    // lacrado retorna 409.
    // Chave pelo hash da tx (não depende de quem assinou nem da ordem das assinaturas).
    const xdrHash = createHash('sha256').update(signedTx.hash()).digest('hex');
    if (quote.consumedAt) {
      if (quote.submitXdrHash === xdrHash && quote.consumedTxHash) {
        logStellarError(
          '[swap/submit] idempotente (já consumido)',
          new Error('retry pós sucesso'),
        );
        return NextResponse.json({
          swapTxHash: quote.consumedTxHash,
          idempotent: true,
        });
      }
      return NextResponse.json({ error: 'quote já consumido' }, { status: 409 });
    }
    // L1-S2: o quote expira mesmo com o onramp `completed` — o preço de emissão
    // (NAV congelado) só vale dentro da janela do quote. Reserva órfã (mesma XDR já
    // em curso) segue para a reconciliação, que consulta a chain.
    const onRampOrder = quote.onRampOrder;
    if (!quote.submitXdrHash && quote.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'quote expirado' }, { status: 410 });
    }
    if (!onRampOrder || onRampOrder.status !== 'completed') {
      return NextResponse.json(
        { error: 'onramp não está em status completed' },
        { status: 409 },
      );
    }

    const instructions = onRampOrder.paymentInstructionsJson as
      | (Record<string, unknown> & { __mock?: boolean })
      | null;
    if (instructions?.__mock === true) {
      return NextResponse.json(
        { error: 'swap mock já foi executado em /swap/build' },
        { status: 409 },
      );
    }

    await assertElegivelParaTrustline({
      investidorId: quote.investidorId,
      publicKey: investorPubkey,
    });

    // C-01: valida que a XDR assinada bate com o quote server-side — a Plina só
    // assina depois disto. Sem isso, a signature não amarra amount/asset/destinos.
    // As chaves vêm só do env: o body não escolhe quem emite nem quem recebe o ponte.
    const issuerPubkey = process.env.STELLAR_ISSUER_PUBLIC;
    const distributorPubkey = process.env.STELLAR_DISTRIBUTOR_PUBLIC;
    if (!issuerPubkey || !distributorPubkey) {
      return NextResponse.json(
        { error: 'configuração Stellar ausente' },
        { status: 500 },
      );
    }
    // M1-3: duas pernas com amounts distintos. Quote sem preço de emissão
    // (legado/anterior ao M1-3) é recusado — nunca cai em 1:1.
    if (!quote.plinarfAmount || !quote.navPorTokenNaCotacao) {
      return NextResponse.json(
        { error: 'cotação sem preço de emissão ao NAV — refaça a cotação' },
        { status: 409 },
      );
    }
    const expectedBridgeAmount = parseStellarAmount(quote.toAmount).toFixed(7);
    const expectedPlinarfAmount = parseStellarAmount(quote.plinarfAmount).toFixed(7);
    const classe = classeOrDefault(quote.classe);
    assertClasseDisponivel(classe); // N1: cotação antiga de Subordinada também é recusada
    const plinarfCode = assetCodeForClasse(classe);
    const tesouro = await resolveTesouroAsset(investorPubkey);
    try {
      assertSwapXdrMatchesQuote(signedXdr, {
        investorPubkey,
        distributorPubkey,
        issuerPubkey,
        bridgeAsset: { code: tesouro.code, issuer: tesouro.issuer },
        expectedBridgeAmount,
        expectedPlinarfAmount,
        plinarfCode,
        // N1-S1: o envelope só vale até o prazo do quote (+120 s) e leva o memo do build.
        quoteExpiresAt: quote.expiresAt,
        memoTexto: `q:${quote.id.slice(0, 24)}`,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `xdr divergente do quote: ${err instanceof Error ? err.message : 'unknown'}`,
        },
        { status: 400 },
      );
    }

    // Mitigação de disponibilidade (Argus/Atlas): com outro swap do MESMO investidor em conferência (reserva
    // órfã), não abre reserva nova. A reserva desta mesma cotação (retry) segue.
    if (!quote.submitXdrHash) {
      await assertSemSwapEmConferencia(quote.investidorId, { ignorarQuoteId: quote.id });
    }

    // N1-S1(c) (Argus/Atlas): o fee abaixo do mínimo da rede volta tx_insufficient_fee/tx_bad_seq e deixa uma
    // reserva órfã: recusa ANTES de reservar e assinar. O memo e o prazo são conferidos pelo validador
    // (memoTexto = o do build, quoteExpiresAt). O fee só vale em reserva NOVA: numa órfã a tx pode já estar
    // no ledger com o fee de antes e precisa ser reconciliada, não recusada.
    const txRecebida = new Transaction(signedXdr, networkPassphrase);
    if (!quote.submitXdrHash) {
      const feeMinimo = BigInt(await getDynamicFee()) * BigInt(txRecebida.operations.length);
      if (BigInt(txRecebida.fee) < feeMinimo) {
        return NextResponse.json(
          { error: 'fee abaixo do mínimo da rede — refaça o swap (rebuild)' },
          { status: 400 },
        );
      }
    }

    // L1-S2: relê o NAV e recusa se divergiu da cotação além de 1 bp. Só em reserva
    // nova: numa reserva órfã a tx pode já estar no ledger e o NAV de agora (com o
    // supply novo e o caixa ainda não escriturado) não é o da cotação.
    if (!quote.submitXdrHash) {
      try {
        await revalidarNavDaCotacao({
          fromAmount: quote.fromAmount,
          fee: quote.fee,
          navPorTokenNaCotacao: quote.navPorTokenNaCotacao,
        });
      } catch (err) {
        if (err instanceof NavMudouError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
        }
        const indisponivel = navUnavailableResponse(err, 'swap/submit');
        if (indisponivel) return indisponivel;
        throw err;
      }
    }

    // C-04: reserva o xdrHash ANTES do submit. Race window de 2 chamadas
    // simultâneas: a primeira ganha (count=1), a segunda 409.
    // N1: guarda também o hash da tx e o maxTime do envelope, para escriturar ou liberar uma
    // reserva órfã sem esperar o investidor (reconciliarSwapsOrfaos).
    const expectedTxHash = txHashFromXdr(signedXdr);
    const maxTimeEnvelope = Number(txRecebida.timeBounds?.maxTime ?? 0);
    const reserved = await db.quote.updateMany({
      where: { id: quote.id, submitXdrHash: null },
      data: {
        submitXdrHash: xdrHash,
        submitTxHash: expectedTxHash,
        submitMaxTime: maxTimeEnvelope > 0 ? new Date(maxTimeEnvelope * 1000) : null,
        // O envelope reservado é assinado SÓ pelo investidor (sem assinatura da Plina): a prova do desfecho
        // pela conta dele (situacaoEnvelopeSwap) precisa do XDR.
        submitXdr: signedXdr,
      },
    });
    if (reserved.count !== 1) {
      const fresh = await db.quote.findUnique({
        where: { id: quote.id },
        select: { submitXdrHash: true, consumedTxHash: true, consumedAt: true },
      });
      // Já totalmente escriturado → idempotente.
      if (fresh?.consumedAt && fresh.submitXdrHash === xdrHash && fresh.consumedTxHash) {
        return NextResponse.json({
          swapTxHash: fresh.consumedTxHash,
          idempotent: true,
        });
      }
      // Reservado por OUTRA xdr → 409 real.
      if (fresh?.submitXdrHash !== xdrHash) {
        return NextResponse.json(
          { error: 'quote já em flight com outra XDR' },
          { status: 409 },
        );
      }
      // Mesma xdr, sem consumedAt → reserva órfã: o submit pode ter mintado
      // on-chain mas o commit no DB morreu no meio. NÃO trava em 409 — cai no
      // fluxo de submit-or-reconcile abaixo, que checa a chain antes de agir.
    }

    // Fecha a janela de crash: numa reserva nova (count===1) a tx ainda não foi
    // submetida; numa reserva órfã (recovery), o hash é determinístico a partir
    // da XDR, então consultamos o Horizon — se a tx já está on-chain com sucesso,
    // os tokens já foram mintados e só falta escriturar (sem re-submeter).
    const onchain =
      reserved.count === 1 ? null : await fetchTransactionByHash(expectedTxHash);

    // Libera a reserva (só desta XDR e só enquanto não consumida): sem isso o quote fica "em voo" para
    // sempre e o gate do NAV (SWAP_EM_VOO) fecha a plataforma inteira.
    const liberarReserva = () => liberarReservaDoSwap(quote.id, xdrHash);

    let finalHash: string;
    if (onchain?.successful) {
      finalHash = onchain.hash;
    } else if (onchain && !onchain.successful) {
      // Entrou e falhou on-chain: a sequence foi consumida e nada foi emitido (prova positiva).
      await liberarReserva();
      return NextResponse.json(
        { error: 'tx anterior falhou on-chain — refaça o swap (rebuild)' },
        { status: 409 },
      );
    } else {
      // N1-S1 (Argus/Atlas): reserva órfã com a tx fora da chain só pode ser RE-ASSINADA enquanto o
      // envelope ainda vale (antes do maxTime). Depois disso a Plina NUNCA assina de novo (410): o preço
      // (NAV congelado) e o quote já venceram, e re-assinar emitiria ao preço velho. A reserva NÃO é
      // liberada por "não achei a tx" (um Horizon atrasado pode não mostrar uma tx que entrou): fica
      // órfã, com o gate do NAV fechado, até haver prova positiva (reconciliarSwapsOrfaos: sucesso →
      // escritura; falha → libera) ou decisão do operador pelo runbook.
      if (reserved.count !== 1) {
        const maxTime = Number(txRecebida.timeBounds?.maxTime ?? 0);
        const agora = Math.floor(Date.now() / 1000);
        if (!maxTime || agora > maxTime) {
          return NextResponse.json(
            {
              error:
                'envelope expirado — a Plina não assina mais este swap; a conferência na rede é feita pela operação',
              code: 'GONE',
            },
            { status: 410 },
          );
        }
      }
      // A Plina assina só agora, com o XDR já validado e a assinatura do
      // investidor conferida. O envelope é reenviado sem assinaturas e as duas
      // entram em `submitWithPrivySignature` (investidor + issuer).
      const issuerSig = preSignWithSigner(issuerSigner(), signedXdr);
      if (issuerSig.pubkey !== issuerPubkey) {
        throw new Error('signer do issuer diverge da configuração');
      }
      const unsigned = new Transaction(signedXdr, networkPassphrase);
      unsigned.signatures.length = 0;
      // N1-at (Vera F-N1AT-1): a guarda de trustline é só LEITURA e roda ANTES de qualquer envio. Se ela recusa (trustline
      // revogada entre o build e o submit) ou a leitura falha, NADA foi à rede: no 1º envio da reserva ela é liberada na
      // hora (o gate do NAV SWAP_EM_VOO não fecha). No REENVIO de uma órfã a tx pode já ter entrado: a reserva fica e o
      // varredor decide pela prova.
      let chegouAoEnvio = false;
      try {
        await exigirEmissoesParaTrustlineAutorizada(unsigned);
        chegouAoEnvio = true;
        const submitRes = await submitWithPrivySignature({
          xdr: unsigned.toXDR(),
          investorPubkey,
          investorSignatureHex: `0x${investorSig.toString('hex')}`,
          extraSignatures: [
            { pubkey: issuerSig.pubkey, sigBase64: issuerSig.sigBase64 },
          ],
        });
        finalHash = submitRes.hash;
      } catch (err) {
        // A guarda dentro de submitWithPrivySignature também roda antes da rede: uma recusa dela também é "nada enviado".
        const naoEnviou = !chegouAoEnvio || err instanceof TrustlineNaoAutorizadaError;
        if (naoEnviou && reserved.count === 1) await liberarReserva();
        if (err instanceof TrustlineNaoAutorizadaError) {
          throw new ApiError(err.code, 409, err.message);
        }
        throw err;
      }
    }

    await escriturarSwap({
      quote: {
        id: quote.id,
        investidorId: quote.investidorId,
        fromAmount: quote.fromAmount,
        fee: quote.fee,
        classe: quote.classe,
      },
      plinarfAmount: expectedPlinarfAmount,
      finalHash,
      orderId: onRampOrder.id,
      privyId: user.privyId,
    });

    return NextResponse.json({ swapTxHash: finalHash });
  } catch (err) {
    // Erro de negócio (ex.: 403 KYC, 409, 422 classe): responde com o status e o código dele. O
    // withAuth só mapeia AuthError, então relançar aqui viraria 500 sem tratamento.
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    logStellarError('[swap/submit]', err);
    // 500 FIXO: err.message pode carregar caminho de arquivo, URL do banco ou o envelope
    // co-assinado. Do Horizon vão só `title` e os `result_codes` (op_underfunded, tx_bad_auth…),
    // que o log já tem e que explicam a falha ao cliente sem expor internos.
    const safe = extractSafeError(err);
    return NextResponse.json(
      {
        error: 'erro interno',
        title: safe.title,
        resultCodes: safe.result_codes,
      },
      { status: 500 },
    );
  }
});
