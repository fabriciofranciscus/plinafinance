/**
 * GET /api/vender/minhas — "Minhas solicitações" do cedente (Atlas, 15/11).
 *
 * Headers: Authorization: Bearer <privy-access-token>   (withPessoaAuth)
 *
 * Lista só os leads da PRÓPRIA Pessoa da sessão (`LeadVendedor.pessoaId`), do mais novo ao mais antigo (até 50). Cada item
 * abre `/vender/acompanhar/<id>`. SEM PII: nunca devolve nome, e-mail, telefone, CPF nem a administradora; só o id, o
 * estado do funil e o resumo da oferta mais recente (valores e validade). Quem ainda não tem Pessoa (pré-KYC) recebe lista
 * vazia (200), não erro.
 *
 * Resposta: { solicitacoes: Array<{
 *   id: string,                 // id do lead (o mesmo da URL /vender/acompanhar/<id>)
 *   status: LeadVendedorStatus, // NOVO … COTA_INCORPORADA | PERDIDO
 *   etapa: number,              // etapa do wizard (lib/vender/etapas)
 *   encerrado: boolean,         // PERDIDO (solicitação encerrada sem sucesso)
 *   concluido: boolean,         // PIX_EXECUTADO ou COTA_INCORPORADA
 *   criadoEm: string,           // ISO-8601
 *   atualizadoEm: string,       // ISO-8601
 *   oferta: null | { status: OfertaStatus, tipoBem: TipoBem, valorCarta: string, valorLiquido: string, validade: string }
 * }> }   (valores em BRL, 2 casas, como string)
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { etapaDoStatus, isConcluido, isEncerrado } from '@/lib/vender/etapas';

export const dynamic = 'force-dynamic';

const LIMITE = 50;

export const GET = withPessoaAuth(async (req, { user }) => {
  if (!(await publicLimiter.consume(clientIp(req)))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }
  // Pré-KYC: ainda não há Pessoa, logo nenhum lead ligado a ela.
  if (!user.pessoaId) return NextResponse.json({ solicitacoes: [] });

  try {
    const leads = await db.leadVendedor.findMany({
      where: { pessoaId: user.pessoaId },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE,
      select: {
        id: true,
        status: true,
        criadoEm: true,
        atualizadoEm: true,
        ofertas: {
          orderBy: { criadaEm: 'desc' },
          take: 1,
          select: { status: true, tipoBem: true, valorCarta: true, valorLiquidoVendedor: true, validade: true },
        },
      },
    });
    return NextResponse.json({
      solicitacoes: leads.map((l) => {
        const o = l.ofertas[0] ?? null;
        return {
          id: l.id,
          status: l.status,
          etapa: etapaDoStatus(l.status),
          encerrado: isEncerrado(l.status),
          concluido: isConcluido(l.status),
          criadoEm: l.criadoEm.toISOString(),
          atualizadoEm: l.atualizadoEm.toISOString(),
          oferta: o
            ? {
                status: o.status,
                tipoBem: o.tipoBem,
                valorCarta: o.valorCarta.toFixed(2),
                valorLiquido: o.valorLiquidoVendedor.toFixed(2),
                validade: o.validade.toISOString(),
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error('[vender/minhas]', (err as { name?: string })?.name ?? 'erro');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
});
