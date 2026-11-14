/**
 * POST /api/investidor/liquidar/submit  (E2-6; contrato contratos/2026-11-11-e2-4-resgate-api.md)
 *
 * Submete o resgate com queima. O envelope vem assinado SÓ pelo investidor; a Plina (distributor) assina por último,
 * depois de conferir o XDR contra a cotação persistida. Idempotente por XDR; ownership pela sessão.
 *
 * Body: { quoteId, signedXdr }
 * Resposta: { txHash }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { internalErrorResponse } from '@/lib/api/internal-error';
import { navUnavailableResponse } from '@/lib/api/nav-unavailable';
import { obterPrecoLiquidoTesouroBrl } from '@/lib/anchors/etherfuse/preco-tesouro';
import { submeterResgate } from '@/lib/services/resgate';
import { withAuth } from '@/lib/wallet/auth-guard';
import { parseBody } from '@/lib/http/parse-body';
import { stellarXdr } from '@/lib/http/zod-stellar';
import { extractSafeError } from '@/lib/stellar/log-error';

export const dynamic = 'force-dynamic';
// O submit pode esperar a rede (envio + confirmação); o limite padrão da função é curto.
export const maxDuration = 60;

const Schema = z
  .object({
    quoteId: z.string().min(1).max(60),
    signedXdr: stellarXdr(),
  })
  .strict();

export const POST = withAuth(async (req, { user }) => {
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  try {
    const result = await submeterResgate({
      investidor: { id: user.investidorId, publicKey: user.publicKey, privyId: user.privyId },
      quoteId: parsed.data.quoteId,
      signedXdr: parsed.data.signedXdr,
      // Chamado só em reserva NOVA: relê o preço do TESOURO na mesma fonte da cotação (desvio > 1 bp → 409).
      obterPrecoTesouroBrl: async () => {
        if (!user.etherfuseCustomerId) throw new ApiError('CONFLICT', 409, 'Conclua o cadastro antes de resgatar.');
        return obterPrecoLiquidoTesouroBrl({ customerId: user.etherfuseCustomerId, stellarAddress: user.publicKey });
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const indisponivel = navUnavailableResponse(err, 'liquidar/submit');
    if (indisponivel) return indisponivel;
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    // Falha do Horizon: só title e result_codes (ajudam o cliente sem vazar internos); o resto é 500 fixo.
    const safe = extractSafeError(err);
    if (safe.result_codes || safe.title) {
      console.error('[liquidar/submit] rede recusou', safe);
      return NextResponse.json(
        { error: 'a rede recusou a transação', code: 'STELLAR_SUBMIT_FAILED', title: safe.title, resultCodes: safe.result_codes },
        { status: 502 },
      );
    }
    return internalErrorResponse(err, 'liquidar/submit');
  }
});
