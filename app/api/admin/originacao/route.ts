/**
 * POST /api/admin/originacao
 *
 * Endpoint multiplexor pra ações de admin no funil vendedor. Auth via
 * cookie `plina_admin`. Cada action é um estágio do pipeline:
 *
 *   - gerar-oferta            → cria Oferta firme + envia
 *   - registrar-cessao        → DocuSign sandbox stub + hash on-chain
 *   - executar-pix-simulado   → marca Pix executado + audit
 *   - incorporar-cota         → wrapper de tokenizacao.incorporarCota
 *   - confirmar-titular-laudo → o operador ATESTA titular do laudo = CPF do cadastro (E1-2)
 *   - pagar-cedente           → Pix ao titular da cessão ASSINADA (E1-2; destino/valor vêm do servidor)
 *   - reabrir-pagamento-cedente → reabre só um pagamento FALHOU confirmado pelo PSP (E1-2)
 *
 * Body: { action, ...payload }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminAuthenticated } from '@/lib/auth/admin';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';
import { parseBody } from '@/lib/http/parse-body';
import {
  executarPixSimulado,
  gerarOferta,
  incorporarCotaDoFunil,
  registrarAnuencia,
  registrarLaudoDaCessao,
  registrarCessao,
} from '@/lib/services/originacao';
import { registrarTesourariaLegada } from '@/lib/services/tesouraria-legada';
import { pagarCedenteDaCessao, PagamentoCedenteError, reabrirPagamentoCedente } from '@/lib/services/pagamento-cedente';
import { LiquidacaoCedenteError } from '@/lib/services/liquidacao-cedente';
import { confirmarTitularDoLaudo, SITUACOES_TITULAR, TitularLaudoError } from '@/lib/services/titular-laudo';
import { STELLAR_NETWORK } from '@/lib/stellar/config';
import { TipoBem } from '@prisma/client';

export const dynamic = 'force-dynamic';
// A ação `incorporar-cota` faz envio on-chain (com reenvio) dentro de uma $transaction de até 120 s
// (exceção registrada em testnet, E1-4 M3): o limite da função precisa cobrir isso. Em Server Actions
// o `maxDuration` vai na PÁGINA que as usa (app/admin/page.tsx, dona: Flora).
export const maxDuration = 150;

const NumericString = z.string().regex(/^\d+(\.\d+)?$/, 'valor numérico inválido');

/**
 * Operador das ações do E1-2 (auditoria): a sessão admin é um cookie único, sem identidade por usuário, então o operador é
 * a constante do servidor — NUNCA um campo do body. Pela mesma razão o body NÃO aceita provedor, chave Pix, valor nem
 * nenhum `opts`: o provedor vem só da configuração do servidor e o destino/valor da cessão (Consuelo/Atlas, 13/11).
 */
const OPERADOR_ADMIN = 'admin-panel';

/** Erros de domínio do E1-2: mensagem fixa em PT (sem causa nem dado do cedente) + código. */
function respostaDeErroDoPagamento(err: unknown): NextResponse | null {
  if (err instanceof TitularLaudoError || err instanceof PagamentoCedenteError || err instanceof LiquidacaoCedenteError) {
    const code = err.code;
    const status =
      code === 'ENTRADA_INVALIDA' ? 400
      : code === 'CESSAO_NAO_ENCONTRADA' || code === 'TRANSFERENCIA_NAO_ENCONTRADA' ? 404
      : code === 'SEGREDO_NAO_CONFIGURADO' || code === 'TETO_NAO_CONFIGURADO' ? 503
      : 409;
    return NextResponse.json({ error: err.message, code }, { status });
  }
  return null;
}

const Schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('gerar-oferta'),
      leadVendedorId: z.string().min(1).max(60),
      tipoBem: z.enum(['IMOVEL', 'VEICULO', 'EQUIPAMENTO', 'SERVICO']),
      valorCarta: NumericString,
      administradora: z.string().min(1).max(200),
      desagioAquisicao: NumericString,
      prazoRestanteMeses: z.number().int().positive().max(600).optional(),
      validadeHoras: z.number().int().positive().max(168).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('registrar-cessao'),
      ofertaId: z.string().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal('executar-pix-simulado'),
      cessaoId: z.string().min(1).max(60),
    })
    .strict(),
  z.object({ action: z.literal('registrar-tesouraria-legada') }).strict(),
  z
    .object({
      action: z.literal('registrar-laudo'),
      cessaoId: z.string().min(1).max(60),
      laudoUrl: z.string().url().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('registrar-anuencia'),
      hashValidacao: z.string().regex(/^[0-9a-f]{64}$/i, 'hash sha-256 hex'),
      status: z.enum(['CONFIRMADA', 'DECLARADA_PENDENTE']),
      referencia: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('confirmar-titular-laudo'),
      cessaoId: z.string().min(1).max(60),
      situacao: z.enum(SITUACOES_TITULAR),
      // O operador atesta; ninguém digita o CPF (o sistema lê o da Pessoa com KYC e grava só o HMAC).
      atestado: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('pagar-cedente'), cessaoId: z.string().min(1).max(60) }).strict(),
  z.object({ action: z.literal('reabrir-pagamento-cedente'), cessaoId: z.string().min(1).max(60) }).strict(),
  z
    .object({
      action: z.literal('incorporar-cota'),
      cessaoId: z.string().min(1).max(60),
      localizacaoAprox: z.string().max(200).optional(),
      desagioRevenda: NumericString.optional(),
    })
    .strict(),
]);

export async function POST(req: Request) {
  const csrf = requireAdminCsrf(req);
  if (csrf) return csrf;
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = await parseBody(req, Schema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  try {
    switch (body.action) {
      case 'gerar-oferta': {
        const result = await gerarOferta({
          leadVendedorId: body.leadVendedorId,
          tipoBem: body.tipoBem as TipoBem,
          valorCarta: body.valorCarta,
          administradora: body.administradora,
          desagioAquisicao: body.desagioAquisicao,
          prazoRestanteMeses: body.prazoRestanteMeses,
          validadeHoras: body.validadeHoras ?? 48,
          operador: 'admin-panel',
        });
        return NextResponse.json({ ofertaId: result.id });
      }
      case 'registrar-cessao': {
        const result = await registrarCessao({
          ofertaId: body.ofertaId,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'executar-pix-simulado': {
        // Caminho LEGADO: só exige cessão ASSINADA e contorna laudo, titular, PSP, comprovante e âncora do E1-2, mas
        // habilita a incorporação. Na mainnet o pagamento é só o `pagar-cedente` (fail-closed).
        if (STELLAR_NETWORK === 'PUBLIC') {
          return NextResponse.json(
            { error: 'Pix simulado não é permitido na mainnet: use pagar-cedente.', code: 'PIX_SIMULADO_EM_MAINNET' },
            { status: 409 },
          );
        }
        const result = await executarPixSimulado({
          cessaoId: body.cessaoId,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'registrar-tesouraria-legada': {
        const result = await registrarTesourariaLegada({ operador: 'admin-panel' });
        return NextResponse.json(result);
      }
      case 'registrar-laudo': {
        const result = await registrarLaudoDaCessao({
          cessaoId: body.cessaoId,
          laudoUrl: body.laudoUrl,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'registrar-anuencia': {
        const result = await registrarAnuencia({
          hashValidacao: body.hashValidacao,
          status: body.status,
          referencia: body.referencia,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
      case 'confirmar-titular-laudo': {
        const result = await confirmarTitularDoLaudo({
          cessaoId: body.cessaoId,
          situacao: body.situacao,
          atestado: body.atestado,
          operador: OPERADOR_ADMIN,
        });
        return NextResponse.json(result);
      }
      case 'pagar-cedente': {
        const result = await pagarCedenteDaCessao({ cessaoId: body.cessaoId, operador: OPERADOR_ADMIN });
        return NextResponse.json(result);
      }
      case 'reabrir-pagamento-cedente': {
        const result = await reabrirPagamentoCedente({ cessaoId: body.cessaoId, operador: OPERADOR_ADMIN });
        return NextResponse.json(result);
      }
      case 'incorporar-cota': {
        const result = await incorporarCotaDoFunil({
          cessaoId: body.cessaoId,
          localizacaoAprox: body.localizacaoAprox,
          desagioRevenda: body.desagioRevenda,
          operador: 'admin-panel',
        });
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    const dominio = respostaDeErroDoPagamento(err);
    if (dominio) return dominio;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
