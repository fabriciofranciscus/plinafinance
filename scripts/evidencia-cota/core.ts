/**
 * E1-P — núcleo puro do script de evidência da cota (`pnpm evidencia:cota <cotaId>`).
 *
 * Para 1 cota, monta a trilha em ordem
 *   validação → cessão → liquidação → incorporação → emissão
 * e, em cada passo, CONFERE (não apenas lista): SHA-256 recalculado do documento GUARDADO ==
 * hash registrado no banco == Memo.hash lido da tx no Horizon. Decisão do Atlas (11/11): vale para TODAS as
 * transições ancoradas — validação (laudo), cessão (PDF), liquidação (comprovante), incorporação (registro canônico
 * JSON, âncora PRÓPRIA e ANTERIOR à emissão). A emissão é "o pagamento que emitiu PLINA-RF": memo = sha256 da chave
 * de incorporação (invariante do E1-4) e o pagamento é aberto (ativo, valor, origem) e conferido. Todo acesso externo entra por
 * `Fontes` (banco, Blob, Horizon), então o núcleo roda em teste com dublês e o `main` só liga as portas.
 *
 * Regras: só leitura; nenhum segredo; nenhuma escrita em banco/chain; testnet apenas.
 */
import { createHash } from 'node:crypto';

export type PassoId = 'VALIDACAO' | 'CESSAO' | 'LIQUIDACAO' | 'INCORPORACAO' | 'EMISSAO';

export interface TxLida {
  /** Tx existe e foi bem-sucedida no ledger. */
  sucesso: boolean;
  /** Memo.hash em hex minúsculo (64), ou null se a tx não tem memo do tipo hash. */
  memoHex: string | null;
  /** Ordem total no ledger (paging_token do Horizon, numérico). Compara "antes/depois" sem ambiguidade. */
  ordem?: string;
  /** Operações de payment da tx (só as de ativo). Preenchido pelo Horizon; opcional em dublês. */
  pagamentos?: { asset: string; amount: string; from: string; to: string }[];
}

/** Registro canônico da incorporação (Atlas, E1): guardado como JSON e ancorado com ancorarSha256 ANTES da emissão. */
export interface RegistroIncorporacao {
  /** Bytes GUARDADOS (Blob). Nunca reserializados: o hash é dos bytes. */
  bytes: Buffer;
  /** Hash que o banco diz ter ancorado. */
  hashRegistrado: string | null;
  /** Tx da âncora própria (Memo.hash = sha256(bytes)). */
  txHash: string | null;
}

export interface Fontes {
  cota(id: string): Promise<{
    id: string;
    cessaoId: string | null;
    hashValidacao: string | null;
    validacaoTxHash: string | null;
    emissaoTxHash: string | null;
    tokensEmitidos: string;
  } | null>;
  /** EventoAudit COTA_VALIDADA com payloadHash == hashValidacao. */
  laudo(hashValidacao: string): Promise<{ payloadJson: unknown; payloadHash: string | null } | null>;
  cessao(cessaoId: string): Promise<{
    status: string;
    hashDocumento: string | null;
    onChainTxHash: string | null;
  } | null>;
  /** Bytes GUARDADOS do PDF assinado (Blob privado, DS3). Nunca baixa de novo no DocuSign. */
  pdfCessao(cessaoId: string): Promise<Buffer | null>;
  /** Liquidação ao cedente (main: TransferenciaPix). `e2eId` = EndToEndId do Pix (não é dado pessoal). */
  pagamento(cessaoId: string): Promise<{ status: string; onChainTxHash: string | null; hashComprovante?: string | null; e2eId?: string | null } | null>;
  /** Bytes GUARDADOS do comprovante do PSP (E1-2). */
  comprovante(cessaoId: string): Promise<Buffer | null>;
  /** Registro canônico da incorporação guardado + âncora própria; null = o app ainda não gerou. */
  registroIncorporacao(cotaId: string): Promise<RegistroIncorporacao | null>;
  /** Ativo PLINA-RF (código + conta emissora): o que o pagamento de emissão deve conter. */
  ativo(): { code: string; issuer: string };
  /** MovimentoFundo APORTE_COTA da cota. */
  aporte(cotaId: string): Promise<{
    txHash: string | null;
    hashValidacao: string | null;
    valorBrl: string;
    navPorToken: string | null;
  } | null>;
  /** Horizon: null = tx não encontrada. Erro de rede PROPAGA (nunca vira "não achou"). */
  tx(txHash: string): Promise<TxLida | null>;
  /** sha256 do payload canônico do laudo (`sha256OfPayload` de lib/stellar/audit). */
  hashPayload(payload: unknown): string;
}

export interface PassoEvidencia {
  ordem: number;
  passo: PassoId;
  rotulo: string;
  txHash: string | null;
  explorerUrl: string | null;
  /** O que foi hasheado (descrição, sem dado pessoal). */
  documento: string | null;
  /** SHA-256 recalculado a partir do documento guardado. */
  sha256Documento: string | null;
  /** SHA-256 que o banco diz ter registrado. */
  sha256Registrado: string | null;
  /** Memo.hash lido da tx. */
  memoOnChain: string | null;
  confere: boolean;
  /** Passo cuja funcionalidade ainda não está nesta base e SEM nenhum artefato: aparece como pendente, não como falha. */
  pendente: boolean;
  /** Preenchido sempre que confere=false: por que a prova não fecha. */
  motivo?: string;
}

export interface EvidenciaCota {
  cotaId: string;
  geradaEm: string;
  network: 'TESTNET';
  passos: PassoEvidencia[];
  todosConferem: boolean;
  /**
   * CADEIA_COMPLETA = cota do funil com todos os passos conferindo; LEGADA = cota sem cessão (seed/legada: sem
   * cadeia de cessão e liquidação, nunca "completa"); INCOMPLETA = o resto (decisão F-EP-2, Consuelo/Atlas).
   */
  classificacao: 'CADEIA_COMPLETA' | 'LEGADA' | 'INCOMPLETA';
  /** Todos os passos conferem, salvo os PENDENTES (funcionalidade ainda fora desta base). */
  conferemExcetoPendentes: boolean;
}

export interface OpcoesEvidencia {
  /**
   * Passos cuja funcionalidade ainda não está nesta base (ex.: CESSAO sem o DS3, INCORPORACAO sem o registro canônico).
   * Só viram PENDENTE se não houver NENHUM artefato do passo; artefato parcial é conferido normalmente (não mascara).
   */
  pendentesNestaBase?: PassoId[];
}

export const sha256Hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
/** Decimal canônico p/ comparar "100", "100.00" e "100.0000000" sem float. */
export const dec = (x: string | number | null | undefined): string | null => {
  if (x === null || x === undefined) return null;
  const t = String(x).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  const frac = f.replace(/0+$/, '');
  return frac ? `${i.replace(/^(-?)0+(?=\d)/, '$1')}.${frac}` : i.replace(/^(-?)0+(?=\d)/, '$1');
};
const HEX64 = /^[0-9a-f]{64}$/;
export const explorerTx = (h: string): string => `https://stellar.expert/explorer/testnet/tx/${h}`;

/** Mesma fórmula de `memoHashDaIncorporacao` (tokenizacao.ts); um teste trava a igualdade. */
export const memoDaIncorporacao = (chave: string): string => sha256Hex(`plina:incorporacao:${chave}`);

function base(ordem: number, passo: PassoId, rotulo: string): PassoEvidencia {
  return {
    ordem, passo, rotulo, txHash: null, explorerUrl: null, documento: null,
    sha256Documento: null, sha256Registrado: null, memoOnChain: null, confere: false, pendente: false,
  };
}

/** Fecha um passo: todos os hashes presentes, válidos e IGUAIS; tx bem-sucedida. */
async function conferir(p: PassoEvidencia, f: Fontes, esperado: { doc: string | null; reg: string | null; tx: string | null }): Promise<PassoEvidencia> {
  p.sha256Documento = esperado.doc;
  p.sha256Registrado = esperado.reg;
  p.txHash = esperado.tx;
  if (esperado.tx) p.explorerUrl = explorerTx(esperado.tx);
  if (!esperado.tx) return { ...p, motivo: 'SEM_TX: passo sem tx on-chain registrada' };
  if (!esperado.doc) return { ...p, motivo: 'SEM_DOCUMENTO: documento guardado não encontrado' };
  if (!esperado.reg) return { ...p, motivo: 'SEM_HASH_REGISTRADO: o banco não tem o hash deste passo' };
  const t = await f.tx(esperado.tx);
  if (!t) return { ...p, motivo: 'TX_NAO_ENCONTRADA: Horizon não conhece a tx' };
  p.memoOnChain = t.memoHex;
  if (!t.sucesso) return { ...p, motivo: 'TX_FALHOU: tx existe mas não foi bem-sucedida' };
  if (!t.memoHex) return { ...p, motivo: 'SEM_MEMO_HASH: a tx não carrega Memo.hash' };
  if (![esperado.doc, esperado.reg, t.memoHex].every((h) => HEX64.test(h))) {
    return { ...p, motivo: 'HASH_MALFORMADO: esperado 64 hex minúsculos' };
  }
  if (esperado.doc !== esperado.reg) return { ...p, motivo: 'DOCUMENTO_DIVERGE_DO_REGISTRO: sha256(documento) ≠ hash no banco' };
  if (esperado.doc !== t.memoHex) return { ...p, motivo: 'MEMO_DIVERGE: Memo.hash on-chain ≠ sha256(documento)' };
  return { ...p, confere: true };
}

/** Conteúdo do registro canônico × cota/aporte/emissor + ordem (âncora estritamente antes da emissão). null = ok. */
async function validarRegistro(
  bytes: Buffer,
  cota: NonNullable<Awaited<ReturnType<Fontes['cota']>>>,
  aporte: Awaited<ReturnType<Fontes['aporte']>>,
  issuer: string,
  emissaoTx: string | null,
  ancoraTx: string,
  f: Fontes,
  /** Hashes dos passos 2 (PDF da cessão) e 3 (comprovante do Pix e a tx da âncora dele). */
  elos: { pdf: string | null; comprovante: string | null; comprovanteTx: string | null },
): Promise<string | null> {
  let j: Record<string, unknown>;
  try { j = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; } catch { return 'REGISTRO_NAO_E_JSON'; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return 'REGISTRO_NAO_E_JSON';
  // Formato do evento COTA_INCORPORADA (E1-p): mesmos dados, nomes do contrato 2026-11-13-e1-p-incorporacao-ancorada.
  if (j.tipo === 'COTA_INCORPORADA') {
    j = { ...j, valor: j.valorIncorporadoBrl, quantidade: j.tokensEmitir, navPorToken: j.navPorTokenUsado };
    if (j.hashLaudo !== cota.hashValidacao) return 'REGISTRO_DIVERGE: hashLaudo ≠ laudo da cota';
    // F-EP-2 (Consuelo/Atlas): na cota do funil os elos são obrigatórios e iguais aos passos 2 e 3.
    if (cota.cessaoId) {
      const exigidos: [string, unknown, string | null, string][] = [
        ['sha256PdfCessao', j.sha256PdfCessao, elos.pdf, 'passo 2 (PDF da cessão)'],
        ['comprovantePixSha256', j.comprovantePixSha256, elos.comprovante, 'passo 3 (comprovante do Pix)'],
        ['comprovantePixAncoraTxHash', j.comprovantePixAncoraTxHash, elos.comprovanteTx, 'passo 3 (tx da âncora do Pix)'],
      ];
      for (const [campo, valor] of exigidos) {
        if (valor === null || valor === undefined || valor === '') return `REGISTRO_INCOMPLETO: ${campo} ausente (cota do funil)`;
      }
      for (const [campo, valor, esperado, onde] of exigidos) {
        if (valor !== esperado) return `REGISTRO_DIVERGE: ${campo} ≠ ${onde}`;
      }
    }
  }
  const faltam = ['cotaId', 'cessaoId', 'valor', 'navPorToken', 'quantidade', 'issuer'].filter((k) => !(k in j));
  if (faltam.length) return `REGISTRO_INCOMPLETO: faltam ${faltam.join(', ')}`;
  if (j.cotaId !== cota.id) return 'REGISTRO_DE_OUTRA_COTA: cotaId ≠ cota';
  if ((j.cessaoId ?? null) !== (cota.cessaoId ?? null)) return 'REGISTRO_DIVERGE: cessaoId ≠ cota';
  if (j.issuer !== issuer) return 'REGISTRO_DIVERGE: issuer ≠ emissor do PLINA-RF';
  if (dec(j.quantidade as string) === null || dec(j.quantidade as string) !== dec(cota.tokensEmitidos)) return 'REGISTRO_DIVERGE: quantidade ≠ tokens emitidos';
  if (!aporte) return 'SEM_APORTE: MovimentoFundo APORTE_COTA não registrado';
  if (dec(j.valor as string) === null || dec(j.valor as string) !== dec(aporte.valorBrl)) return 'REGISTRO_DIVERGE: valor ≠ aporte';
  if (dec(j.navPorToken as string) === null || dec(j.navPorToken as string) !== dec(aporte.navPorToken)) return 'REGISTRO_DIVERGE: navPorToken ≠ aporte';
  if (!aporte.txHash || aporte.txHash !== emissaoTx) return 'APORTE_FORA_DA_TX_DE_EMISSAO: txHash do aporte ≠ emissaoTxHash da cota';
  if (aporte.hashValidacao !== cota.hashValidacao) return 'APORTE_SEM_O_LAUDO: hashValidacao do aporte ≠ da cota';
  if (!emissaoTx) return 'SEM_TX: cota sem tx de emissão';
  if (ancoraTx === emissaoTx) return 'ANCORA_NAO_ANTES_DA_EMISSAO: a âncora é a própria tx de emissão';
  const [ta, te] = [await f.tx(ancoraTx), await f.tx(emissaoTx)];
  if (!ta?.ordem || !te?.ordem) return 'ORDEM_INDETERMINADA: sem a ordem no ledger não dá para provar que a âncora veio antes da emissão';
  if (BigInt(ta.ordem) >= BigInt(te.ordem)) return 'ANCORA_NAO_ANTES_DA_EMISSAO: a âncora do registro entrou depois (ou junto) da emissão';
  return null;
}

const MOTIVO_PENDENTE: Partial<Record<PassoId, string>> = {
  CESSAO: 'PENDENTE: cessão via DocuSign (DS3) ainda não publicada nesta base',
  INCORPORACAO: 'PENDENTE: registro canônico da incorporação (E1-p) ainda não publicado nesta base',
};

function marcarPendente(p: PassoEvidencia): PassoEvidencia {
  return { ...p, confere: false, pendente: true, motivo: MOTIVO_PENDENTE[p.passo] ?? 'PENDENTE' };
}

export async function montarEvidencia(
  cotaId: string,
  f: Fontes,
  agora: () => Date = () => new Date(),
  opcoes: OpcoesEvidencia = {},
): Promise<EvidenciaCota> {
  const pendentes = new Set(opcoes.pendentesNestaBase ?? []);
  const cota = await f.cota(cotaId);
  if (!cota) throw new Error(`Cota ${cotaId} não encontrada.`);
  const passos: PassoEvidencia[] = [];

  // 1. Validação: documento = laudo (payload canônico).
  {
    const p = base(1, 'VALIDACAO', 'Validação legal (laudo)');
    const laudo = cota.hashValidacao ? await f.laudo(cota.hashValidacao) : null;
    p.documento = laudo ? 'laudo de validação (payload canônico)' : null;
    const doc = laudo ? f.hashPayload(laudo.payloadJson) : null;
    // O registro precisa ser o MESMO nos dois lugares do banco (Cota e EventoAudit).
    const reg = laudo && laudo.payloadHash === cota.hashValidacao ? cota.hashValidacao : null;
    const r = await conferir(p, f, { doc, reg, tx: cota.validacaoTxHash });
    if (!laudo && !r.motivo) r.motivo = 'SEM_DOCUMENTO';
    passos.push(r);
  }

  // 2. Cessão: documento = bytes GUARDADOS do PDF assinado.
  {
    const p = base(2, 'CESSAO', 'Cessão assinada (DocuSign)');
    const cessao = cota.cessaoId ? await f.cessao(cota.cessaoId) : null;
    const pdf = cota.cessaoId ? await f.pdfCessao(cota.cessaoId) : null;
    p.documento = pdf ? 'PDF assinado guardado (Blob privado)' : null;
    const r = await conferir(p, f, {
      doc: pdf ? sha256Hex(pdf) : null,
      reg: cessao?.hashDocumento ?? null,
      tx: cessao?.onChainTxHash ?? null,
    });
    if (cessao && cessao.status !== 'ASSINADA' && r.confere) {
      r.confere = false;
      r.motivo = `CESSAO_NAO_ASSINADA: status=${cessao.status}`;
    }
    if (!cota.cessaoId) r.motivo = 'COTA_SEM_CESSAO: cota incorporada direto, sem funil de cessão';
    const semNadaDoDs3 = cota.cessaoId && !pdf && !cessao?.hashDocumento && !cessao?.onChainTxHash;
    passos.push(pendentes.has('CESSAO') && semNadaDoDs3 ? marcarPendente(r) : r);
  }

  // 3. Liquidação: documento = bytes GUARDADOS do comprovante do PSP (sem sobrescrita: allowOverwrite=false no E1-2).
  //    Memo = SHA-256 dos bytes guardados. Se o banco registra o hash do comprovante (`hashComprovante`), ele precisa
  //    bater com os bytes de hoje (pega sobrescrita depois da âncora); sem o campo, o memo da tx é o registro.
  {
    const p = base(3, 'LIQUIDACAO', 'Liquidação ao cedente (comprovante do PSP)');
    const pg = cota.cessaoId ? await f.pagamento(cota.cessaoId) : null;
    const comp = cota.cessaoId ? await f.comprovante(cota.cessaoId) : null;
    p.documento = comp ? 'comprovante do PSP guardado' : null;
    const doc = comp ? sha256Hex(comp) : null;
    const tx = pg?.onChainTxHash ?? null;
    const memo = tx ? (await f.tx(tx))?.memoHex ?? null : null;
    const reg = pg?.hashComprovante !== undefined ? pg.hashComprovante : memo;
    const r = await conferir(p, f, { doc, reg, tx });
    if (r.confere && pg && !['COMPROVADA', 'EXECUTADO'].includes(pg.status)) {
      r.confere = false;
      r.motivo = `LIQUIDACAO_NAO_COMPROVADA: status=${pg.status}`;
    }
    // Consuelo (2): preço pago = V = APORTE_COTA. O comprovante canônico do E1-2 (JSON) traz "valor".
    if (r.confere && pg?.status === 'COMPROVADA') {
      let valor: string | null = null;
      try {
        const j = JSON.parse(comp!.toString('utf8')) as { valor?: unknown };
        valor = typeof j?.valor === 'string' ? dec(j.valor) : null;
      } catch { valor = null; }
      const aporte = await f.aporte(cotaId);
      if (valor === null) { r.confere = false; r.motivo = 'COMPROVANTE_ILEGIVEL: o comprovante canônico não traz "valor"'; }
      else if (!aporte || valor !== dec(aporte.valorBrl)) {
        r.confere = false;
        r.motivo = 'LIQUIDACAO_VALOR_DIVERGE: valor do comprovante ≠ valor incorporado (APORTE_COTA)';
      }
    }
    if (pg?.e2eId) r.documento = `${r.documento ?? 'comprovante do PSP'} · endToEndId ${pg.e2eId}`;
    passos.push(r);
  }

  // 4. Incorporação: transição PRÓPRIA (Atlas): registro canônico JSON guardado + âncora (Memo.hash = sha256 dos
  //    bytes), ANTES da tx de emissão; o conteúdo do registro precisa bater com cota, aporte e emissão.
  {
    const p = base(4, 'INCORPORACAO', 'Incorporação ao NAV (registro canônico ancorado, antes da emissão)');
    const reg = await f.registroIncorporacao(cotaId);
    const a = await f.aporte(cotaId);
    p.documento = reg ? 'registro canônico da incorporação guardado (JSON)' : null;
    if (!reg) {
      p.motivo = 'SEM_REGISTRO_INCORPORACAO: o registro canônico da incorporação não existe (transição própria ainda não gerada)';
      passos.push(pendentes.has('INCORPORACAO') ? marcarPendente(p) : p);
    } else {
      const r = await conferir(p, f, { doc: sha256Hex(reg.bytes), reg: reg.hashRegistrado, tx: reg.txHash });
      if (r.confere) {
        r.confere = false;
        const p2 = passos.find((x) => x.passo === 'CESSAO');
        const p3 = passos.find((x) => x.passo === 'LIQUIDACAO');
        const motivo = await validarRegistro(reg.bytes, cota, a, f.ativo().issuer, cota.emissaoTxHash, reg.txHash!, f, {
          pdf: p2?.sha256Documento ?? null,
          comprovante: p3?.sha256Documento ?? null,
          comprovanteTx: p3?.txHash ?? null,
        });
        if (motivo) r.motivo = motivo; else r.confere = true;
      }
      passos.push(r);
    }
  }

  // 5. Emissão = "o pagamento que emitiu PLINA-RF": memo = sha256("plina:incorporacao:" + chave) (invariante do
  //    E1-4; chave = cessaoId ?? hashValidacao). NÃO é hash de arquivo. Abrimos o pagamento: ativo, valor e origem.
  {
    const p = base(5, 'EMISSAO', 'Emissão de PLINARF (pagamento que emitiu o token)');
    const chave = cota.cessaoId ?? cota.hashValidacao;
    p.documento = chave ? 'chave de incorporação (cessaoId ?? hashValidacao) → memo plina:incorporacao:<chave>' : null;
    const esperado = chave ? memoDaIncorporacao(chave) : null;
    const r = await conferir(p, f, { doc: esperado, reg: esperado, tx: cota.emissaoTxHash });
    if (r.confere) {
      const t = (await f.tx(cota.emissaoTxHash!))!;
      const { code, issuer } = f.ativo();
      if (!t.pagamentos) {
        r.confere = false; r.motivo = 'PAGAMENTO_NAO_LIDO: não consegui abrir as operações da tx de emissão';
      } else {
        const ok = t.pagamentos.some((x) => x.asset === `${code}:${issuer}` && x.from === issuer && dec(x.amount) === dec(cota.tokensEmitidos));
        if (!ok) { r.confere = false; r.motivo = `PAGAMENTO_EMISSAO_DIVERGE: nenhum payment de ${code} do emissor com ${cota.tokensEmitidos} na tx`; }
        else r.documento = `${r.documento} · payment ${code} ${cota.tokensEmitidos} do emissor`;
      }
    }
    passos.push(r);
  }

  return {
    cotaId,
    geradaEm: agora().toISOString(),
    network: 'TESTNET',
    passos,
    todosConferem: passos.every((x) => x.confere),
    classificacao: !cota.cessaoId ? 'LEGADA' : passos.every((x) => x.confere) ? 'CADEIA_COMPLETA' : 'INCOMPLETA',
    conferemExcetoPendentes: passos.every((x) => x.confere || x.pendente),
  };
}

export function paraMarkdown(e: EvidenciaCota): string {
  const linhas = [
    `# Evidência da cota ${e.cotaId}`,
    '',
    `Rede: ${e.network} · gerada em ${e.geradaEm} · resultado: **${e.todosConferem ? 'TODOS CONFEREM' : e.conferemExcetoPendentes ? 'CONFEREM, COM PASSO PENDENTE' : 'HÁ PASSO SEM PROVA'}**`,
    '',
    `Classificação: **${e.classificacao === 'LEGADA' ? 'LEGADA — sem cadeia de cessão e liquidação' : e.classificacao === 'CADEIA_COMPLETA' ? 'CADEIA COMPLETA' : 'INCOMPLETA'}**`,
    '',
    '| # | Passo | Tx (explorer) | SHA-256 do documento | Memo on-chain | Confere |',
    '|---|---|---|---|---|---|',
    ...e.passos.map((p) =>
      `| ${p.ordem} | ${p.rotulo} | ${p.txHash ? `[${p.txHash.slice(0, 12)}…](${p.explorerUrl})` : '—'} | ${p.sha256Documento ?? '—'} | ${p.memoOnChain ?? '—'} | ${p.confere ? '✓' : p.pendente ? `⏳ pendente — ${p.motivo ?? ''}` : `✗ ${p.motivo ?? ''}`} |`),
  ];
  return linhas.join('\n') + '\n';
}
