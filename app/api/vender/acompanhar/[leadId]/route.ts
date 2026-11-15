/**
 * GET /api/vender/acompanhar/[leadId] — detalhe da solicitação do cedente, SÓ para o dono (item 19, Argus).
 *
 * Headers: Authorization: Bearer <privy-access-token>   (withPessoaAuth)
 *
 * O `leadId` aparece em e-mails, prints e no Referer, então não vale como senha: o detalhe (nome, valores da oferta, txs) só
 * sai para a Pessoa dona do lead (`LeadVendedor.pessoaId`). Sem token → 401. Id inexistente, lead de outra pessoa e pessoa
 * ainda sem cadastro (pré-KYC) dão o MESMO 404 `{ error: 'não encontrado' }`: a rota não confirma que o id existe.
 *
 * Resposta 200 (direta, sem envelope; valores em BRL como string; datas ISO-8601):
 *   { leadId, status, etapaAtual, encerrado, contextoDescricao, cedenteNome: string | null, ofertaId: string | null,
 *     oferta: null | { valorCarta, desagioPct, valorLiquido, prazoRestanteMeses: number | null, validade },
 *     cessaoId, consentTx, cessaoTx, pixTx: null | { hashShort, url }, temCota, aguardandoAssinatura }
 * Sem CPF, e-mail, telefone nem chave Pix.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { publicLimiter, clientIp } from '@/lib/rate-limit/config';
import { withPessoaAuth } from '@/lib/wallet/pessoa-auth';
import { acompanharDoDono } from '@/lib/services/acompanhar';

export const dynamic = 'force-dynamic';

const LeadId = z.string().min(1).max(60);
const NAO_ENCONTRADO = () => NextResponse.json({ error: 'não encontrado' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return withPessoaAuth(async (r, { user }) => {
    if (!(await publicLimiter.consume(clientIp(r)))) {
      return NextResponse.json({ error: 'too many requests' }, { status: 429 });
    }
    const id = LeadId.safeParse(leadId);
    if (!id.success) return NAO_ENCONTRADO();
    try {
      const detalhe = await acompanharDoDono(id.data, user.pessoaId);
      return detalhe ? NextResponse.json(detalhe) : NAO_ENCONTRADO();
    } catch (err) {
      console.error('[vender/acompanhar]', (err as { name?: string })?.name ?? 'erro');
      return NextResponse.json({ error: 'erro interno' }, { status: 500 });
    }
  })(req);
}
