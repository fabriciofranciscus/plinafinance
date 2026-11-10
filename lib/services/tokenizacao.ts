/**
 * Tokenizacao service — orquestra incorporação de cotas e clawback.
 *
 * Key rules CLAUDE.md cumpridas aqui:
 *   - DB só atualiza APÓS sucesso on-chain (Stellar tx submit antes do Prisma create).
 *   - Audit log append-only via EventoAudit.
 *   - Idempotência: emissão usa UUID-like via DB para evitar duplicação caso
 *     o submit fique pendurado (POC aceita risco de retry duplo — Stellar
 *     submitTransaction é geralmente idempotente por hash do envelope).
 *   - Clawback exige motivo (enum força em compile-time) + fundamentoUrl
 *     ANTES de chamar executeClawback no issuer.
 *
 * Whitepaper §6.4 (PLINA-RF lastro), §6.5 (política clawback).
 */

import { createHash } from 'node:crypto';
import {
  AnuenciaStatus,
  CaminhoRealizacao,
  MotivoClawback,
  Prisma,
  StatusCota,
  TipoBem,
} from '@prisma/client';
import { db } from '../db';
import { buscarEmissaoPorMemo, executeClawback, issueAsset } from '../stellar/issuer';
import { issuerSigner } from '../stellar/signer';
import { navDaCotaAsDecimal } from './pool';
import { calcularPrecoDeEmissao } from './emissao';
import { registrarMovimentoFundo } from './razao-fundo';
import { getStellarPlinaPositionPublic } from '../env/ops';
import { logStellarError } from '../stellar/log-error';
import { STELLAR_NETWORK, assetCode } from '../stellar/config';
import { assetCodeForClasse, classeFromAssetCode } from '../stellar/classes';
import { decrementarHolding } from './holdings';
import { buildAuditPayload, registerOnChainHash } from '../stellar/audit';

export interface IncorporarCotaInput {
  tipoBem: TipoBem;
  administradora: string;
  valorCarta: string;
  desagioAquisicao: string;
  desagioRevenda?: string;
  localizacaoAprox?: string;
  prazoRestanteMeses?: number;
  caminhoPrevisto?: CaminhoRealizacao;
  notas?: string;
  operador: string;
  /// Quando a cota veio do funil vendedor, liga à Cessao que originou.
  cessaoId?: string;
  /// Hash do laudo (`registrarLaudo`/`COTA_VALIDADA`). OBRIGATÓRIO: sem laudo
  /// registrado a emissão é recusada (E1-4, Lei 11.795 art. 13). Tipado como
  /// opcional só para não quebrar chamadores antigos — a recusa é em runtime.
  hashValidacao?: string;
  /// Pix pago ao cedente (funil). Se vier, precisa bater com o custo de aquisição.
  pixValorBrl?: string;
  /// Hash do comprovante/tx do Pix; vai para o `MovimentoFundo` APORTE_COTA.
  pixHash?: string;
}

export interface IncorporarCotaResult {
  cotaId: string;
  txHash: string;
  tokensEmitidos: number;
}

export type IncorporacaoBloqueioCodigo =
  | 'LAUDO_AUSENTE'
  | 'LAUDO_JA_USADO'
  | 'ANUENCIA_AUSENTE'
  | 'ANUENCIA_PENDENTE_EM_MAINNET'
  | 'POSICAO_PLINA_AUSENTE'
  | 'CUSTO_INVALIDO'
  | 'PIX_DIVERGE_DO_CUSTO';

const BLOQUEIO_MENSAGEM: Record<IncorporacaoBloqueioCodigo, string> = {
  LAUDO_AUSENTE: 'Emissão recusada: laudo de validação legal não registrado (hashValidacao).',
  LAUDO_JA_USADO: 'Emissão recusada: este laudo já sustenta outra cota.',
  ANUENCIA_AUSENTE:
    'Emissão recusada: anuência da administradora não registrada (nem como declarada pendente).',
  ANUENCIA_PENDENTE_EM_MAINNET:
    'Emissão recusada: em mainnet a anuência precisa estar CONFIRMADA; "declarada pendente" só vale em testnet.',
  POSICAO_PLINA_AUSENTE:
    'Emissão recusada: conta de posição da Plina não configurada.',
  CUSTO_INVALIDO: 'Emissão recusada: custo de aquisição não positivo.',
  PIX_DIVERGE_DO_CUSTO: 'Emissão recusada: valor do Pix difere do custo de aquisição.',
};

export class IncorporacaoBloqueadaError extends Error {
  constructor(readonly code: IncorporacaoBloqueioCodigo) {
    super(BLOQUEIO_MENSAGEM[code]);
    this.name = 'IncorporacaoBloqueadaError';
  }
}

/**
 * Pré-condições de domínio da emissão (parecer da Consuelo, C2): laudo
 * registrado (com `hashValidacao`) + anuência (real, ou "declarada pendente"
 * em testnet). A prova é o `EventoAudit` — append-only, não um campo que o
 * chamador pudesse inventar.
 */
export async function verificarPreCondicoesDeEmissao(hashValidacao: string | undefined): Promise<{
  hashValidacao: string;
  validacaoTxHash: string | null;
  anuenciaStatus: AnuenciaStatus;
}> {
  if (!hashValidacao) throw new IncorporacaoBloqueadaError('LAUDO_AUSENTE');
  const laudo = await db.eventoAudit.findFirst({
    where: { acao: 'COTA_VALIDADA', payloadHash: hashValidacao },
    select: { stellarTxHash: true },
  });
  if (!laudo) throw new IncorporacaoBloqueadaError('LAUDO_AUSENTE');

  const anuencia = await db.eventoAudit.findFirst({
    where: {
      acao: 'ANUENCIA_REGISTRADA',
      payloadJson: { path: ['hashValidacao'], equals: hashValidacao },
    },
    orderBy: { criadoEm: 'desc' },
    select: { payloadJson: true },
  });
  const status = (anuencia?.payloadJson as { status?: string } | null)?.status;
  if (status !== 'CONFIRMADA' && status !== 'DECLARADA_PENDENTE') {
    throw new IncorporacaoBloqueadaError('ANUENCIA_AUSENTE');
  }
  if (status === 'DECLARADA_PENDENTE' && STELLAR_NETWORK === 'PUBLIC') {
    throw new IncorporacaoBloqueadaError('ANUENCIA_PENDENTE_EM_MAINNET');
  }

  return {
    hashValidacao,
    validacaoTxHash: laudo.stellarTxHash ?? null,
    anuenciaStatus: status as AnuenciaStatus,
  };
}

/** Memo.hash determinístico da emissão: um por cessão (ou, sem cessão, por laudo). */
export function memoHashDaIncorporacao(chave: string): Buffer {
  return createHash('sha256').update(`plina:incorporacao:${chave}`).digest();
}

/** Id determinístico da Cota: a PK vira a unicidade da incorporação (cessão/laudo). */
function cotaIdDaIncorporacao(memoHash: Buffer): string {
  return `inc_${memoHash.toString('hex').slice(0, 32)}`;
}

/**
 * Incorpora cota ao pool como APORTE da Plina ao NAV (ADR 2026-11-09, opção B):
 * `q = quantidadeEmitida(V, NAV antes)`, com V = custo de aquisição (= Pix ao
 * cedente). O token nasce na posição da Plina e a cota entra no ativo por V —
 * o NAV por token não muda.
 *
 * "DB depois da chain" e idempotência (contrato E1-4, 2026-11-10):
 *  1. pré-condições (laudo + anuência, conta de posição, custo/Pix) — só leitura;
 *  2. numa `$transaction`, lock de concorrência SEM linha de domínio
 *     (`pg_advisory_xact_lock` pela chave da incorporação);
 *  3. a cota já existe? (mesmo id determinístico) → devolve o resultado, sem
 *     reemitir; laudo usado por outra cota → recusa;
 *  4. `buscarEmissaoPorMemo`: se a emissão daquela incorporação já está na
 *     chain (crash entre submit e commit), reaproveita o `txHash` e a quantidade
 *     emitida — não reemite;
 *  5. senão preço ao NAV (fail-closed, D3) e `issueAsset(..., { memoHash })`;
 *  6. só depois do sucesso on-chain, na mesma transação: `Cota`, `EventoAudit`
 *     e `MovimentoFundo` APORTE_COTA. Falha em qualquer ponto desfaz a
 *     transação: nenhuma linha de domínio existe sem a tx on-chain.
 */
export async function incorporarCota(
  input: IncorporarCotaInput,
): Promise<IncorporarCotaResult> {
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('STELLAR_ISSUER_SECRET obrigatório.');
  }
  // Conta de posição da Plina pelo getter de `lib/env` (fail-closed, mensagem
  // fixa): ausente ou inválida → emissão recusada, sem vazar nome de env.
  let posicaoPlina: string;
  try {
    posicaoPlina = getStellarPlinaPositionPublic();
  } catch {
    throw new IncorporacaoBloqueadaError('POSICAO_PLINA_AUSENTE');
  }

  const pre = await verificarPreCondicoesDeEmissao(input.hashValidacao);

  // V = custo de aquisição: o mesmo número que entra no ativo (navDaCota).
  const valorAporte = navDaCotaAsDecimal({
    valorCarta: input.valorCarta,
    desagioAquisicao: input.desagioAquisicao,
  });
  if (!valorAporte.gt(0)) throw new IncorporacaoBloqueadaError('CUSTO_INVALIDO');
  if (
    input.pixValorBrl !== undefined &&
    new Prisma.Decimal(input.pixValorBrl).minus(valorAporte).abs().gt('0.01')
  ) {
    throw new IncorporacaoBloqueadaError('PIX_DIVERGE_DO_CUSTO');
  }

  const code = assetCodeForClasse('SENIOR');
  const chaveIncorporacao = input.cessaoId ?? pre.hashValidacao;
  const memoHash = memoHashDaIncorporacao(chaveIncorporacao);
  const cotaId = cotaIdDaIncorporacao(memoHash);

  return db.$transaction(
    async (tx) => {
      // 2) Lock de concorrência: não grava nada, só serializa a mesma incorporação.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`plina:incorporacao:${chaveIncorporacao}`}))`;

      // 3) Já incorporada (reexecução ou chamada concorrente que perdeu o lock).
      const existente = await tx.cota.findUnique({
        where: { id: cotaId },
        select: { id: true, emissaoTxHash: true, tokensEmitidos: true },
      });
      if (existente) {
        return {
          cotaId: existente.id,
          txHash: existente.emissaoTxHash ?? '',
          tokensEmitidos: new Prisma.Decimal(existente.tokensEmitidos).toNumber(),
        };
      }
      const laudoUsado = await tx.cota.findFirst({
        where: { hashValidacao: pre.hashValidacao },
        select: { id: true },
      });
      if (laudoUsado) throw new IncorporacaoBloqueadaError('LAUDO_JA_USADO');

      // 4) A emissão desta incorporação já está na chain? (crash pós-submit)
      const achada = await buscarEmissaoPorMemo({ code, destination: posicaoPlina, memoHash });

      let txHash: string;
      let quantidade: Prisma.Decimal;
      let navAntes: Prisma.Decimal;
      let recuperada = false;
      if (achada) {
        recuperada = true;
        txHash = achada.txHash;
        quantidade = new Prisma.Decimal(achada.amount);
        if (!quantidade.gt(0)) throw new IncorporacaoBloqueadaError('CUSTO_INVALIDO');
        // NAV "antes" reconstruído do que foi de fato emitido (o supply do
        // ledger já inclui esta emissão, então não dá para recalcular).
        navAntes = valorAporte.div(quantidade).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
      } else {
        // 5) NAV antes do aporte (supply zero → 1,00); lança se o ledger não
        // responde ou se PLINARFB circula (D3). Depois emite com o memo.
        const preco = await calcularPrecoDeEmissao({ valorBrl: valorAporte });
        quantidade = preco.plinarfAmount;
        navAntes = preco.navPorTokenNaCotacao;
        try {
          const res = await issueAsset(issuerSigner(), posicaoPlina, quantidade.toFixed(7), code, { memoHash });
          txHash = res.hash;
        } catch (err) {
          logStellarError('[incorporarCota] emissão', err);
          // Nada foi gravado (a transação desfaz). Se a tx chegou a entrar, a
          // próxima chamada a acha pelo memo e não reemite.
          throw new Error('Emissão on-chain falhou; nada foi gravado. Reexecutar é seguro (idempotente por memo).');
        }
      }
      const quantityStr = quantidade.toFixed(7);

      // 6) DB depois da chain, na mesma transação.
      await tx.cota.create({
        data: {
          id: cotaId,
          tipoBem: input.tipoBem,
          administradora: input.administradora,
          valorCarta: input.valorCarta,
          desagioAquisicao: input.desagioAquisicao,
          desagioRevenda: input.desagioRevenda ?? null,
          localizacaoAprox: input.localizacaoAprox ?? null,
          prazoRestanteMeses: input.prazoRestanteMeses ?? null,
          caminhoPrevisto: input.caminhoPrevisto ?? 'A_REVENDA',
          status: StatusCota.DISPONIVEL,
          tokensEmitidos: quantityStr,
          emissaoTxHash: txHash,
          hashValidacao: pre.hashValidacao,
          validacaoTxHash: pre.validacaoTxHash,
          anuenciaStatus: pre.anuenciaStatus,
          notas: input.notas ?? null,
          cessaoId: input.cessaoId ?? null,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'COTA_INCORPORADA',
          operador: input.operador,
          cotaId,
          stellarTxHash: txHash,
          payloadJson: {
            quantity: quantityStr,
            valorCarta: input.valorCarta,
            desagioAquisicao: input.desagioAquisicao,
            valorAporteBrl: valorAporte.toFixed(2),
            navPorTokenAntes: navAntes.toFixed(8),
            hashValidacao: pre.hashValidacao,
            anuenciaStatus: pre.anuenciaStatus,
            recuperadaPorMemo: recuperada,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.eventoAudit.create({
        data: {
          acao: 'TOKEN_EMITIDO',
          operador: input.operador,
          cotaId,
          stellarTxHash: txHash,
          payloadJson: {
            quantity: quantityStr,
            destination: posicaoPlina,
            asset: code,
          } as Prisma.InputJsonValue,
        },
      });
      // A Plina aporta a cota (nunca AQUISICAO: o fundo não pagou): ativo +V,
      // caixa 0, tokens +q. O Pix ao cedente não entra no caixa do fundo.
      const mov = await registrarMovimentoFundo(tx, {
        tipo: 'APORTE_COTA',
        valorBrl: valorAporte,
        tokens: quantityStr,
        chave: `aporte-cota:${cotaId}`,
        cotaId,
        navPorToken: navAntes,
        txHash,
        refHash: input.pixHash,
        hashValidacao: pre.hashValidacao,
      });
      if (!mov.criado) throw new Error('Aporte já registrado para esta incorporação.');

      return { cotaId, txHash, tokensEmitidos: quantidade.toNumber() };
    },
    // A transação cobre a chamada à chain (segundos): timeout acima do padrão de 5 s.
    { timeout: 120_000, maxWait: 15_000 },
  );
}

export interface ExecutarClawbackInput {
  investidorId: string;
  amount: string;
  motivo: MotivoClawback;
  fundamentoUrl: string;
  operador: string;
}

export interface ExecutarClawbackResult {
  /** Tx Stellar da operação clawback (Operation.clawback). */
  txHash: string;
  /** Tx Stellar do Memo.hash do fundamento (whitepaper §3.2). */
  fundamentoTxHash: string;
  /** SHA-256 do payload `{motivo, fundamentoUrl, ...}` gravado on-chain. */
  payloadHash: string;
}

/**
 * Executa clawback. Whitepaper §6.5: 4 hipóteses exclusivas (enum força).
 * Audit log GRAVADO ANTES da execução on-chain — assim mesmo se Stellar
 * falhar, fica registro da tentativa pra auditoria.
 */
export async function executarClawback(
  input: ExecutarClawbackInput,
): Promise<ExecutarClawbackResult> {
  if (!input.fundamentoUrl || !/^https?:\/\//.test(input.fundamentoUrl)) {
    throw new Error('fundamentoUrl obrigatória (URL pública do documento).');
  }
  const amountNum = Number(input.amount);
  if (!isFinite(amountNum) || amountNum <= 0) {
    throw new Error('amount deve ser > 0.');
  }

  const issuerSecret = process.env.STELLAR_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('STELLAR_ISSUER_SECRET obrigatório.');
  }

  const investidor = await db.investidor.findUnique({
    where: { id: input.investidorId },
  });
  if (!investidor) throw new Error(`Investidor ${input.investidorId} não encontrado.`);

  // 1) Audit log da tentativa (antes do on-chain) — auditável mesmo em falha.
  const auditPre = await db.eventoAudit.create({
    data: {
      acao: 'CLAWBACK_EXECUTADO',
      operador: input.operador,
      investidorId: input.investidorId,
      motivoClawback: input.motivo,
      fundamentoUrl: input.fundamentoUrl,
      payloadJson: {
        amount: input.amount,
        targetPubkey: investidor.publicKey,
        status: 'attempting',
      } as Prisma.InputJsonValue,
    },
  });

  // 2) On-chain (clawback).
  const clawbackRes = await executeClawback(
    issuerSigner(),
    investidor.publicKey,
    input.amount,
  );

  // 3) Memo.hash do fundamento (whitepaper §3.2: "fundamento jurídico
  //    vinculado, visível em Stellar Expert"). Self-payment do issuer
  //    com SHA-256 do payload — Stellar Expert decodifica e qualquer
  //    auditor cross-verifica `fundamentoUrl` off-chain contra o hash.
  const fundamentoPayload = buildAuditPayload(
    'clawback_fundamento',
    input.investidorId,
    {
      motivo: input.motivo,
      fundamentoUrl: input.fundamentoUrl,
      targetPubkey: investidor.publicKey,
      amount: input.amount,
      clawbackTxHash: clawbackRes.hash,
    },
  );
  const fundamentoOnChain = await registerOnChainHash(fundamentoPayload);

  // 4) Atualiza audit log + saldoEsperado.
  await db.$transaction(async (tx) => {
    await tx.eventoAudit.update({
      where: { id: auditPre.id },
      data: {
        stellarTxHash: clawbackRes.hash,
        payloadHash: fundamentoOnChain.payloadHash,
        payloadJson: {
          amount: input.amount,
          targetPubkey: investidor.publicKey,
          status: 'executed',
          fundamentoTxHash: fundamentoOnChain.txHash,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.investidor.update({
      where: { id: input.investidorId },
      data: {
        saldoEsperado: {
          decrement: new Prisma.Decimal(input.amount),
        },
      },
    });
    // Mantém o ledger por-classe coerente com o saldoEsperado (PRD §M3).
    // Clawback é SENIOR-only: executeClawback usa o `code` default (assetCode).
    await decrementarHolding(tx, {
      investidorId: input.investidorId,
      classe: classeFromAssetCode(assetCode),
      amount: input.amount,
      txHash: clawbackRes.hash,
    });
  });

  return {
    txHash: clawbackRes.hash,
    fundamentoTxHash: fundamentoOnChain.txHash,
    payloadHash: fundamentoOnChain.payloadHash,
  };
}

export interface AtualizarStatusCotaInput {
  cotaId: string;
  status: StatusCota;
  operador: string;
}

export async function atualizarStatusCota(input: AtualizarStatusCotaInput) {
  // EMISSAO_PENDENTE (E1-4) é do fluxo de incorporação: nem entra nem sai por
  // aqui — promover uma cota sem emissão confirmada poria ativo sem token no NAV.
  const atual = await db.cota.findUnique({
    where: { id: input.cotaId },
    select: { status: true },
  });
  if (
    input.status === StatusCota.EMISSAO_PENDENTE ||
    atual?.status === StatusCota.EMISSAO_PENDENTE
  ) {
    throw new Error('Status EMISSAO_PENDENTE só muda pela incorporação/reconciliação.');
  }
  return db.cota.update({
    where: { id: input.cotaId },
    data: { status: input.status },
  });
}
