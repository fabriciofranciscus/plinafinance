/**
 * Preparação dos 2 registros canônicos para PUBLICAR (L2 da auditoria código × SOW; condições P1 e P2 do Argus).
 *
 * O aceite do E1 pede que o avaliador confirme "cada memo hash = SHA-256 do documento guardado". Dos 4 documentos da cota,
 * só o comprovante do Pix estava publicado. Aqui se preparam os outros dois que NÃO têm dado pessoal:
 *   · a VALIDAÇÃO (payload do laudo, `COTA_VALIDADA`): bytes = `stableSerialize(payload)`, a serialização que gerou o hash;
 *   · a INCORPORAÇÃO (registro canônico, `COTA_INCORPORADA`): bytes = RFC 8785 (`bytesCanonicos`) do `registroCanonico`.
 * (O PDF da cessão NÃO entra: o certificado do DocuSign traz e-mail e IP do signatário; desvio D12 declarado.)
 *
 * Regras: (1) os bytes publicados são EXATAMENTE os que foram hasheados, sem reformatar; (2) só fica pronto se
 * sha256(bytes) = hash gravado na cota/evento (o `memo` na rede é conferido pelo CLI, na Horizon); (3) varredura de dado pessoal
 * antes de qualquer arquivo (CPF, e-mail, telefone, nome e documento do cedente) e `operador` precisa ser uma FUNÇÃO conhecida,
 * não uma pessoa. Qualquer falha = não gera arquivo. Funções puras: sem banco, sem rede.
 */
import { createHash } from 'node:crypto';
import { stableSerialize } from '../../lib/stellar/audit';
import { bytesCanonicos } from '../../lib/services/json-canonico';

const sha256Hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Funções (não pessoas) que aparecem como `operador` no código. Qualquer outro valor vai para revisão manual. */
export const OPERADORES_FUNCAO = [
  'admin-panel',
  'docusign',
  'etherfuse-anchor',
  'investidor-self-service',
  'self-service',
  'webhook-anchor',
  'sandbox-mock',
  'reconciliador-resgate',
  'reconciliador-resgate-vigia',
  'funder-auto',
] as const;

export const operadorEhFuncao = (op: unknown): boolean =>
  typeof op === 'string' && (OPERADORES_FUNCAO as readonly string[]).includes(op);

/** O que NÃO pode aparecer nos arquivos: quem é o cedente (vem do banco, nunca é impresso). */
export interface PessoaParaVarredura {
  nomes: string[];
  documentos: string[];
  emails: string[];
}

export interface ResultadoVarredura {
  cpf: number;
  email: number;
  telefone: number;
  nome: number;
  documentoDoCedente: number;
  total: number;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soDigitos = (t: string) => t.replace(/\D/g, '');
/** Remove sequências hexadecimais longas (hashes, txs) e ids antes de procurar números: evitam falso positivo de CPF/telefone. */
const semHexLongo = (t: string) => t.replace(/\b[0-9a-f]{32,}\b/gi, ' ').replace(/\b[a-z]+_[0-9a-f]{16,}\b/gi, ' ');

export function varreduraPII(texto: string, pessoa: PessoaParaVarredura): ResultadoVarredura {
  const limpo = semHexLongo(texto);
  const cpf = (limpo.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) ?? []).length;
  const email = (limpo.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).length;
  const telefone = (limpo.match(/(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g) ?? []).length;
  const textoSimples = semAcento(texto);
  const nome = pessoa.nomes
    .map((n) => semAcento(n).trim())
    .filter((n) => n.length >= 4)
    .reduce((acc, n) => acc + (textoSimples.split(n).length - 1), 0);
  const digitosDoTexto = soDigitos(limpo);
  const documentoDoCedente = pessoa.documentos
    .map(soDigitos)
    .filter((d) => d.length >= 8)
    .reduce((acc, d) => acc + (digitosDoTexto.includes(d) ? 1 : 0), 0);
  const emailDoCedente = pessoa.emails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'))
    .reduce((acc, e) => acc + (texto.toLowerCase().includes(e) ? 1 : 0), 0);
  const emailTotal = Math.max(email, emailDoCedente);
  return { cpf, email: emailTotal, telefone, nome, documentoDoCedente, total: cpf + emailTotal + telefone + nome + documentoDoCedente };
}

export interface RegistroPreparado {
  ok: boolean;
  /** Código do motivo da recusa (nunca contém dado pessoal). */
  motivo?: string;
  bytes?: Buffer;
  sha256?: string;
  nomeDoArquivo?: string;
  /** Tx cujo Memo.hash precisa ser `sha256` (o CLI confere na Horizon). */
  memoEsperadoDe?: string | null;
  varredura?: ResultadoVarredura;
}

const recusa = (motivo: string, varredura?: ResultadoVarredura): RegistroPreparado => ({ ok: false, motivo, ...(varredura ? { varredura } : {}) });

function aprovar(bytes: Buffer, prefixo: string, memoDe: string | null, pessoa: PessoaParaVarredura): RegistroPreparado {
  const varredura = varreduraPII(bytes.toString('utf8'), pessoa);
  if (varredura.total > 0) return recusa(`PII: a varredura achou ${varredura.total} ocorrência(s) (cpf ${varredura.cpf}, e-mail ${varredura.email}, telefone ${varredura.telefone}, nome ${varredura.nome}, documento ${varredura.documentoDoCedente}); nada foi gerado`, varredura);
  const sha = sha256Hex(bytes);
  return { ok: true, bytes, sha256: sha, nomeDoArquivo: `${prefixo}-${sha.slice(0, 8)}.json`, memoEsperadoDe: memoDe, varredura };
}

export interface EntradaValidacao {
  cota: { hashValidacao: string | null; validacaoTxHash: string | null };
  laudo: { payloadJson: unknown; payloadHash: string | null } | null;
}

export function prepararValidacao(e: EntradaValidacao, pessoa: PessoaParaVarredura): RegistroPreparado {
  if (!e.cota.hashValidacao || !e.laudo) return recusa('SEM_LAUDO: a cota não tem o payload do laudo registrado');
  if (e.laudo.payloadHash !== e.cota.hashValidacao) return recusa('REGISTRO_DIVERGE: o hash do evento do laudo ≠ o hashValidacao da cota');
  const bytes = Buffer.from(stableSerialize(e.laudo.payloadJson), 'utf8');
  if (sha256Hex(bytes) !== e.cota.hashValidacao) return recusa('HASH_DIVERGE: o sha256 dos bytes recalculados ≠ o hash registrado; o arquivo não fecha');
  const operador = (e.laudo.payloadJson as { operador?: unknown } | null)?.operador;
  if (!operadorEhFuncao(operador)) return recusa('OPERADOR_NAO_E_FUNCAO: o campo operador não é uma função conhecida (revisão manual)');
  return aprovar(bytes, 'registro-validacao', e.cota.validacaoTxHash, pessoa);
}

export interface EntradaIncorporacao {
  cota: { id: string };
  incorporacao: { payloadJson: unknown; payloadHash: string | null } | null;
}

export function prepararIncorporacao(e: EntradaIncorporacao, pessoa: PessoaParaVarredura): RegistroPreparado {
  const p = e.incorporacao?.payloadJson as { registroCanonico?: unknown; ancoraTxHash?: string } | null | undefined;
  if (!e.incorporacao || !p?.registroCanonico) return recusa('SEM_REGISTRO: a cota não tem o registro canônico da incorporação');
  if (!p.ancoraTxHash) return recusa('SEM_TX: o registro não aponta a tx da âncora');
  const bytes = bytesCanonicos(p.registroCanonico);
  if (sha256Hex(bytes) !== e.incorporacao.payloadHash) return recusa('HASH_DIVERGE: o sha256 dos bytes canônicos ≠ o payloadHash gravado; o arquivo não fecha');
  return aprovar(bytes, 'registro-incorporacao', p.ancoraTxHash, pessoa);
}

/**
 * Confere na rede (Horizon, leitura pública) que a tx foi bem-sucedida e que o `Memo.hash` é o sha256 do arquivo. O aceite do
 * Argus (P2): só se publica o link se `sha256(arquivo) = memo`. `fetchFn` é injetado (teste sem rede).
 */
export async function conferirMemoNaRede(
  fetchFn: typeof fetch,
  horizonUrl: string,
  txHash: string,
  sha256: string,
): Promise<{ ok: boolean; motivo?: string }> {
  if (!/^[0-9a-f]{64}$/i.test(txHash)) return { ok: false, motivo: 'TX_INVALIDA' };
  let res: Response;
  try {
    res = await fetchFn(`${horizonUrl}/transactions/${txHash}`);
  } catch {
    return { ok: false, motivo: 'REDE_INDISPONIVEL' };
  }
  if (res.status === 404) return { ok: false, motivo: 'TX_NAO_ENCONTRADA' };
  if (!res.ok) return { ok: false, motivo: `HORIZON_${res.status}` };
  const j = (await res.json()) as { successful?: boolean; memo_type?: string; memo?: string };
  if (j.successful !== true) return { ok: false, motivo: 'TX_FALHOU' };
  if (j.memo_type !== 'hash' || !j.memo) return { ok: false, motivo: 'SEM_MEMO_HASH' };
  const memoHex = Buffer.from(j.memo, 'base64').toString('hex');
  return memoHex === sha256.toLowerCase() ? { ok: true } : { ok: false, motivo: 'MEMO_DIVERGE: o Memo.hash da tx ≠ sha256 do arquivo' };
}

