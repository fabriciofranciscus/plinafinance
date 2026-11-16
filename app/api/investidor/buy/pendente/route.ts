/**
 * GET /api/investidor/buy/pendente — a compra que o investidor ainda não terminou (U2 A-02).
 *
 * Só leitura, só do PRÓPRIO investidor. Devolve a ordem do on-ramp MAIS RECENTE que não foi concluída nem morreu, já nos
 * formatos que o /investir usa (`quote` = QuoteData, `onRamp` = OnRampData) e a `fase` em que parou (ver
 * `lib/services/ordem-pendente.ts`). Sem ordem pendente: `{ pendente: null }`. Não consulta o anchor, não escreve nada,
 * não cria caminho novo de dinheiro: quem retoma usa o build/submit do swap de sempre. Sem PII; mensagem de erro fixa.
 */
import { withApi } from '@/lib/api/with-api';
import { ok } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { requireInvestidor } from '@/lib/wallet/auth-guard';
import { clientIp, publicLimiter } from '@/lib/rate-limit/config';
import { buscarOrdemPendente } from '@/lib/services/ordem-pendente-db';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req, { requestId }) => {
  const user = await requireInvestidor(req);
  if (!(await publicLimiter.consume(clientIp(req)))) {
    throw new ApiError('RATE_LIMITED', 429, 'muitas requisições; tente de novo em instantes');
  }

  const achada = await buscarOrdemPendente(user.investidorId);
  if (!achada) return ok({ pendente: null }, { requestId });
  const { ordem, fase } = achada;

  const q = ordem.quote;
  const instrucoes = ordem.paymentInstructionsJson as (Record<string, unknown> & { __mock?: boolean }) | null;
  return ok(
    {
      pendente: {
        fase,
        criadoEm: ordem.criadoEm.toISOString(),
        quote: {
          quoteId: q.id,
          fromAmount: q.fromAmount.toString(),
          toAmount: q.toAmount.toString(),
          plinarfAmount: q.plinarfAmount ? q.plinarfAmount.toFixed(7) : null,
          navPorTokenNaCotacao: q.navPorTokenNaCotacao ? q.navPorTokenNaCotacao.toFixed(8) : null,
          exchangeRate: q.exchangeRate,
          fee: q.fee,
          expiresAt: q.expiresAt.toISOString(),
        },
        onRamp: {
          orderId: ordem.id,
          status: ordem.status,
          paymentInstructions: instrucoes,
          mock: instrucoes?.__mock === true,
          stellarTxHash: ordem.stellarTxHash,
          stellarClaimableBalanceId: ordem.stellarClaimableBalanceId,
          claimTxHash: ordem.claimTxHash,
        },
      },
    },
    { requestId },
  );
});
