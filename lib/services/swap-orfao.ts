/**
 * N1 (Atlas/Argus, mitigação de disponibilidade): enquanto o investidor tiver um swap em conferência
 * (reserva do XDR sem `consumedAt`), ele não cria quote nem reserva novos. Sem isto, um investidor KYC
 * cria órfãs de propósito (XDR com sequence de salto) e fecha o NAV da plataforma de novo a cada vez.
 */

import { db } from '../db';
import { ApiError } from '../api/errors';

export async function assertSemSwapEmConferencia(
  investidorId: string,
  opts: { ignorarQuoteId?: string; ignorarResgateId?: string } = {},
): Promise<void> {
  // Swap de subscrição OU resgate com queima do investidor em conferência (reserva órfã).
  const [aberta, resgateAberto] = await Promise.all([
    db.quote.findFirst({
      where: {
        investidorId,
        submitXdrHash: { not: null },
        consumedAt: null,
        plinarfAmount: { not: null },
        ...(opts.ignorarQuoteId ? { id: { not: opts.ignorarQuoteId } } : {}),
      },
      select: { id: true },
    }),
    db.resgateCotacao.findFirst({
      where: {
        investidorId,
        submitXdrHash: { not: null },
        consumedAt: null,
        ...(opts.ignorarResgateId ? { id: { not: opts.ignorarResgateId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  if (aberta || resgateAberto) {
    throw new ApiError(
      'SWAP_EM_CONFERENCIA',
      409,
      'Você tem uma operação (swap ou resgate) em conferência. Aguarde a conclusão antes de iniciar outra.',
    );
  }
}
