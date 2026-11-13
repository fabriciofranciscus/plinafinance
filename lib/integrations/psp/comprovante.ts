/**
 * Comprovante canônico da transferência confirmada (E1-2). JSON RFC 8785, valores em string. SEM PII: a chave Pix
 * do titular nunca entra; só o destino MASCARADO. O SHA-256 destes bytes é o Memo.hash da âncora.
 */
import { createHash } from 'node:crypto';
import { bytesCanonicos } from '../../services/json-canonico';
import type { TipoChavePix } from './types';

export const COMPROVANTE_TIPO = 'plina.comprovante-pix';

/** Tipo + o mínimo para o titular se reconhecer: últimos 4 (e-mail: 1ª letra + último rótulo do domínio). */
export function mascararDestino(tipo: TipoChavePix, chave: string): string {
  const c = chave.trim();
  if (tipo === 'EMAIL') {
    const [local = '', dominio = ''] = c.split('@');
    const rotulo = dominio.split('.').pop() ?? '';
    return `EMAIL ${local.slice(0, 1)}***@***.${rotulo}`;
  }
  // Chave curta demais sairia quase inteira: sem sufixo.
  return c.length >= 8 ? `${tipo} ***${c.slice(-4)}` : `${tipo} ***`;
}

export interface ComprovanteInput {
  provedor: 'ASAAS' | 'SIMULADO';
  transferenciaId: string;
  e2eId: string | null;
  /** "123.45" */
  valor: string;
  efetivadoEm: string;
  destino: string;
  cessaoId: string;
  referencia: string;
}

export function montarComprovante(i: ComprovanteInput): { bytes: Buffer; sha256: string } {
  const bytes = bytesCanonicos({
    tipo: COMPROVANTE_TIPO,
    versao: 1,
    provedor: i.provedor,
    transferenciaId: i.transferenciaId,
    e2eId: i.e2eId,
    valor: i.valor,
    moeda: 'BRL',
    efetivadoEm: i.efetivadoEm,
    destino: i.destino,
    cessaoId: i.cessaoId,
    referencia: i.referencia,
  });
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
