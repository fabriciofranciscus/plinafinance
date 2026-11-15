/**
 * POST /api/admin/originacao
 *
 * Endpoint multiplexor pra ações de admin no funil vendedor. Auth via
 * cookie `plina_admin`. Cada action é um estágio do pipeline:
 *
 *   - gerar-oferta            → cria Oferta firme + envia
 *   - registrar-cessao        → cria a cessão (PENDENTE), SEM enviar ao DocuSign
 *   - enviar-cessao           → envia ao DocuSign, só com o laudo registrado (qualquer rede)
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
  gerarOferta,
  incorporarCotaDoFunil,
  registrarAnuencia,
  registrarLaudoDaCessao,
  registrarCessao,
  IncorporacaoFunilBloqueadaError,
  comporDesagioDaOferta,
  OfertaInvalidaError,
} from '@/lib/services/originacao';
import { registrarTesourariaLegada } from '@/lib/services/tesouraria-legada';
import { sincronizarCessoesDocusign } from '@/lib/services/cessao-assinatura';
import { pagarCedenteDaCessao, PagamentoCedenteError, reabrirPagamentoCedente } from '@/lib/services/pagamento-cedente';
import { LiquidacaoCedenteError, causaSegura } from '@/lib/services/liquidacao-cedente';
import { DocusignError } from '@/lib/integrations/docusign';
import { EnvioDocusignEmAndamentoError, EnvioDocusignLaudoAusenteError, EnvioDocusignNomeAusenteError, enviarCessaoParaAssinatura } from '@/lib/services/cessao-docusign';
import { OriginacaoPrecondicaoError } from '@/lib/services/originacao-erros';
import { confirmarTitularDoLaudo, SITUACOES_TITULAR, TitularLaudoError } from '@/lib/services/titular-laudo';
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

/** Erros de domínio do E1-2/DS2: mensagem fixa em PT (sem causa nem dado do cedente) + código. */
function respostaDeErroDoPagamento(err: unknown): NextResponse | null {
  // A-02: DocuSign sem configuração ou fora do ar não é "erro interno": o operador precisa saber a causa (mensagens fixas, sem
  // nome de variável, chave nem corpo da resposta).
  if (err instanceof DocusignError) {
    if (err.codigo === 'CONFIG_INVALIDA' || err.codigo === 'CHAVE_PRIVADA_INVALIDA') {
      return NextResponse.json(
        { error: 'DocuSign não configurado neste ambiente (credenciais ausentes ou inválidas).', code: 'DOCUSIGN_NAO_CONFIGURADO' },
        { status: 503 },
      );
    }
    if (err.codigo === 'CONSENTIMENTO_NECESSARIO') {
      return NextResponse.json(
        { error: 'O DocuSign ainda não tem o consentimento da integração: conceda-o no painel do DocuSign e repita.', code: 'DOCUSIGN_CONSENTIMENTO_NECESSARIO' },
        { status: 503 },
      );
    }
    if (err.codigo === 'AUTENTICACAO_FALHOU') {
      return NextResponse.json(
        { error: 'O DocuSign recusou as credenciais da integração.', code: 'DOCUSIGN_AUTENTICACAO_FALHOU' },
        { status: 503 },
      );
    }
    if (err.codigo === 'INDISPONIVEL') {
      return NextResponse.json(
        { error: 'O DocuSign está indisponível agora. Nada foi enviado; tente novamente em instantes.', code: 'DOCUSIGN_INDISPONIVEL' },
        { status: 503 },
      );
    }
  }
  // G5 (item 14): pré-condições do funil que o operador corrige — 404 se não existe, 409 se o estado não permite; mensagem fixa + code.
  if (err instanceof OriginacaoPrecondicaoError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof EnvioDocusignEmAndamentoError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof EnvioDocusignLaudoAusenteError || err instanceof EnvioDocusignNomeAusenteError || err instanceof IncorporacaoFunilBloqueadaError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
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
      // 0 = cota QUITADA (sem componente de prazo; guardado como 0, não null). A-01.
      prazoRestanteMeses: z.number().int().min(0).max(600).optional(),
      validadeHoras: z.number().int().positive().max(168).optional(),
    })
    .strict(),
  // A-08: prévia SOMENTE LEITURA do deságio final (mesma composição do gerar-oferta): o admin vê o que será gravado ANTES de gerar.
  z
    .object({
      action: z.literal('previa-oferta'),
      valorCarta: NumericString,
      administradora: z.string().min(1).max(200),
      desagioAquisicao: NumericString,
      prazoRestanteMeses: z.number().int().min(0).max(600).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('registrar-cessao'),
      ofertaId: z.string().min(1).max(60),
    })
    .strict(),
  z.object({ action: z.literal('enviar-cessao'), cessaoId: z.string().min(1).max(60) }).strict(),
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
      action: z.literal('sincronizar-cessoes'),
      cessaoId: z.string().min(1).max(60).optional(),
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
      case 'previa-oferta': {
        const c = comporDesagioDaOferta({
          valorCarta: body.valorCarta,
          administradora: body.administradora,
          desagioAquisicao: body.desagioAquisicao,
          prazoRestanteMeses: body.prazoRestanteMeses,
        });
        return NextResponse.json({
          desagioBase: c.desagioBase.toFixed(4),
          taxaAnuenciaBps: c.taxaAnuenciaBps,
          taxaPrazoBps: c.taxaPrazoBps,
          desagioTotal: c.desagioTotal.toFixed(4),
          valorLiquido: c.valorLiquido.toFixed(2),
        });
      }
      case 'registrar-cessao': {
        // Só cria a cessão: o envio ao DocuSign é o passo `enviar-cessao`, DEPOIS do laudo (o PDF cita o hash dele).
        const result = await registrarCessao({
          ofertaId: body.ofertaId,
          operador: OPERADOR_ADMIN,
          enviar: false,
        });
        return NextResponse.json(result);
      }
      case 'enviar-cessao': {
        const result = await enviarCessaoParaAssinatura({ cessaoId: body.cessaoId, operador: OPERADOR_ADMIN });
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
      case 'sincronizar-cessoes': {
        // Polling de fallback do DS3: reconcilia cessões ENVIADA_DOCUSIGN sem webhook.
        const result = await sincronizarCessoesDocusign({ cessaoId: body.cessaoId, operador: 'admin-panel' });
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
    // A-22: oferta que o operador pode corrigir (deságio total > 100%, valor inválido) é 422 com a mensagem, não 500.
    if (err instanceof OfertaInvalidaError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    const dominio = respostaDeErroDoPagamento(err);
    if (dominio) return dominio;
    // Argus (LOW, 15/11): o 500 genérico NÃO ecoa `err.message`: mensagem de Prisma e de terceiros pode trazer id, valor ou status.
    // A resposta é fixa ({ error, code }); no log do servidor vão só a ação, o nome e o código da causa (nunca a mensagem).
    console.error('[admin/originacao] erro interno', { acao: body.action, ...causaSegura(err) });
    return NextResponse.json(
      {
        error: 'Erro interno ao processar a ação. O resultado pode não ter sido gravado: confira o estado antes de repetir.',
        code: 'ERRO_INTERNO',
      },
      { status: 500 },
    );
  }
}
