/**
 * E1-p — registro canônico da INCORPORAÇÃO, ancorado ANTES da emissão (SOW 1.4; decisão do Atlas, 13/11).
 * Contrato: contratos/2026-11-13-e1-p-incorporacao-ancorada.md.
 *
 * O registro amarra a incorporação às provas anteriores (laudo, PDF da cessão do DS3, comprovante do Pix do E1-2)
 * e aos números exatos da emissão que vai sair (valor, tokens, NAV usado). É JSON canônico (RFC 8785, via
 * `bytesCanonicos`), com valores em string e SEM dado pessoal; o Memo.hash da âncora é o SHA-256 desses bytes.
 * Os bytes não vão a Blob: ficam no banco como `EventoAudit.payloadJson.registroCanonico` (RFC 8785 é função do
 * VALOR, então reserializar o objeto do jsonb reproduz os mesmos bytes).
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { ancorarSha256 } from '../stellar/ancora';
import { bytesCanonicos } from './json-canonico';

export interface RegistroIncorporacao {
  tipo: 'COTA_INCORPORADA';
  versao: 1;
  cotaId: string;
  cessaoId: string | null;
  hashLaudo: string;
  sha256PdfCessao: string | null;
  comprovantePixSha256: string | null;
  comprovantePixAncoraTxHash: string | null;
  valorIncorporadoBrl: string;
  tokensEmitir: string;
  navPorTokenUsado: string;
  issuer: string;
  asset: string;
}

export interface EntradaRegistroIncorporacao {
  cotaId: string;
  cessaoId: string | null;
  hashLaudo: string;
  valorIncorporadoBrl: Prisma.Decimal;
  tokensEmitir: Prisma.Decimal;
  navPorTokenUsado: Prisma.Decimal;
  issuer: string;
  asset: string;
}

export class RegistroIncorporacaoError extends Error {
  readonly code = 'ANCORA_INCORPORACAO_FALHOU' as const;
  /** A âncora foi enviada e o desfecho é ambíguo (pode entrar): tentar de novo depois, sem emitir agora. */
  readonly ambigua: boolean;
  constructor(options?: { cause?: unknown; ambigua?: boolean }) {
    super('Incorporação recusada: o registro canônico não foi ancorado. Nada foi emitido.', options);
    this.name = 'RegistroIncorporacaoError';
    this.ambigua = options?.ambigua ?? false;
  }
}

/** Monta o registro e os bytes canônicos. Só leitura; sem PII (a chave Pix e o destino nunca entram). */
export async function montarRegistroIncorporacao(
  e: EntradaRegistroIncorporacao,
): Promise<{ registro: RegistroIncorporacao; bytes: Buffer; sha256Hex: string }> {
  let sha256PdfCessao: string | null = null;
  let comprovantePixSha256: string | null = null;
  let comprovantePixAncoraTxHash: string | null = null;
  if (e.cessaoId) {
    const [cessao, pix] = await Promise.all([
      db.cessao.findUnique({ where: { id: e.cessaoId }, select: { status: true, hashDocumento: true } }),
      db.transferenciaPix.findUnique({
        where: { cessaoId: e.cessaoId },
        select: { status: true, comprovanteSha256: true, ancoraTxHash: true },
      }),
    ]);
    if (cessao?.status === 'ASSINADA' && cessao.hashDocumento) sha256PdfCessao = cessao.hashDocumento;
    if (pix?.status === 'COMPROVADA') {
      comprovantePixSha256 = pix.comprovanteSha256 ?? null;
      comprovantePixAncoraTxHash = pix.ancoraTxHash ?? null;
    }
  }
  const registro: RegistroIncorporacao = {
    tipo: 'COTA_INCORPORADA',
    versao: 1,
    cotaId: e.cotaId,
    cessaoId: e.cessaoId,
    hashLaudo: e.hashLaudo,
    sha256PdfCessao,
    comprovantePixSha256,
    comprovantePixAncoraTxHash,
    valorIncorporadoBrl: new Prisma.Decimal(e.valorIncorporadoBrl).toFixed(2),
    tokensEmitir: new Prisma.Decimal(e.tokensEmitir).toFixed(7),
    navPorTokenUsado: new Prisma.Decimal(e.navPorTokenUsado).toFixed(8),
    issuer: e.issuer,
    asset: e.asset,
  };
  const bytes = bytesCanonicos(registro);
  return { registro, bytes, sha256Hex: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * Monta e ANCORA o registro pelo distributor (`desde` = criação do claim). Idempotente pelo hash: os mesmos
 * números reutilizam a âncora. Qualquer falha → `RegistroIncorporacaoError` (quem chama não emite).
 */
export async function ancorarRegistroIncorporacao(
  e: EntradaRegistroIncorporacao & { desde: Date },
): Promise<{ registro: RegistroIncorporacao; sha256Hex: string; ancoraTxHash: string }> {
  const { desde, ...entrada } = e;
  if (!entrada.issuer) throw new RegistroIncorporacaoError(); // registro sem emissor não prova nada
  const m = await montarRegistroIncorporacao(entrada);
  try {
    // semEspera: a incorporação chama de dentro da sua $transaction (I1 do Argus); ambíguo não espera ~130 s.
    const a = await ancorarSha256({ sha256Hex: m.sha256Hex, contexto: 'COTA_INCORPORADA', desde, semEspera: true });
    return { registro: m.registro, sha256Hex: m.sha256Hex, ancoraTxHash: a.txHash };
  } catch (err) {
    const ambigua = (err as { code?: string } | null)?.code === 'ANCORA_NAO_CONFIRMADA';
    throw new RegistroIncorporacaoError({ cause: err, ambigua });
  }
}
