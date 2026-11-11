/**
 * Conferência de um snapshot do NAV publicado (E3-1): a prova do avaliador. Núcleo PURO — recebe os bytes do arquivo
 * e um leitor de Horizon injetado (o script `scripts/snapshot-verificar.ts` liga o leitor ao Horizon público, com código
 * próprio e independente do que produz o snapshot). Contrato: contratos/2026-11-11-e3-1-snapshot-nav.md §5.
 *
 * Cada conferência devolve `ok` (✓), `falhou` (✗) ou `nao_conferido`: o Horizon não guarda saldo histórico, então se
 * os saldos de hoje diferem dos do arquivo E o ledger já passou do ledger do snapshot, diz isso em vez de fingir que
 * conferiu ou de reprovar o arquivo.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalizar } from './json-canonico';
import {
  SNAPSHOT_TIPO,
  SNAPSHOT_VERSAO,
  f7,
  f8,
  recalcularNav,
  type ArquivoSnapshotNav,
} from './snapshot-nav-arquivo';

export interface TxHorizon {
  hash: string;
  successful: boolean;
  source_account: string;
  memo_type: string;
  /** Memo hash em base64, como o Horizon devolve. */
  memo?: string;
  created_at: string;
}

export interface LeitorHorizon {
  ledgerAtual(): Promise<{ ledger: number; fechadoEm: string }>;
  /** Σ de `/assets` do asset (autorizado + obrigações + não autorizado + claimable + LP + contratos). */
  totalEmitido(code: string, issuer: string): Promise<Prisma.Decimal>;
  saldoDaConta(conta: string, code: string, issuer: string): Promise<Prisma.Decimal>;
  /** Σ das trustlines autorizadas conta a conta, sem a conta `excluir`. */
  trustlinesAutorizadas(
    code: string,
    issuer: string,
    excluir: string,
  ): Promise<{ soma: Prisma.Decimal; contas: number }>;
  /** Transações bem-sucedidas da conta cujo memo hash (base64) é `memoB64`. */
  buscarPorMemo(conta: string, memoB64: string): Promise<TxHorizon[]>;
}

export type Estado = 'ok' | 'falhou' | 'nao_conferido';
export interface Conferencia {
  id: string;
  estado: Estado;
  detalhe: string;
}
export interface ResultadoVerificacao {
  sha256: string;
  conferencias: Conferencia[];
  /** 0 tudo conferido · 1 alguma conferência falhou · 2 nada falhou mas há conferência que o Horizon não permite refazer */
  codigoSaida: 0 | 1 | 2;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function verificarSnapshot(
  bytes: Buffer,
  leitor: LeitorHorizon,
  opts: { txHash?: string; issuerEsperado?: string; distributorEsperado?: string } = {},
): Promise<ResultadoVerificacao> {
  const conf: Conferencia[] = [];
  const add = (id: string, estado: Estado, detalhe: string) => conf.push({ id, estado, detalhe });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fim = (): ResultadoVerificacao => ({
    sha256,
    conferencias: conf,
    codigoSaida: conf.some((c) => c.estado === 'falhou') ? 1 : conf.some((c) => c.estado === 'nao_conferido') ? 2 : 0,
  });

  // 1. O arquivo é o documento canônico (RFC 8785) e tem o formato esperado.
  let arq: ArquivoSnapshotNav;
  const texto = bytes.toString('utf8');
  try {
    arq = JSON.parse(texto) as ArquivoSnapshotNav;
    if (arq.tipo !== SNAPSHOT_TIPO || arq.versao !== SNAPSHOT_VERSAO) throw new Error('tipo/versão');
    if (canonicalizar(arq) !== texto) throw new Error('bytes não são a forma canônica');
    add('arquivo', 'ok', `${SNAPSHOT_TIPO} v${arq.versao}, dia ${arq.data}, JSON canônico (RFC 8785)`);
  } catch (e) {
    add('arquivo', 'falhou', `arquivo inválido: ${e instanceof Error ? e.message : 'erro'}`);
    return fim();
  }
  add('sha256', 'ok', `SHA-256 do arquivo publicado = ${sha256}`);

  const classe = arq.circulante[arq.nav.classe];
  if (!classe) {
    add('arquivo', 'falhou', `classe ${arq.nav.classe} ausente em circulante`);
    return fim();
  }

  // 1b. As contas são da Plina? Issuer, distributor e rede vêm do PRÓPRIO arquivo; sem fixá-los, um arquivo forjado
  // com contas e âncora de outra parte sairia conferido (F-E31-2). O revisor informa as contas da Plina (as do pacote
  // de evidência); se não informar, o resultado nunca é "conferido".
  const contas = Object.entries(arq.circulante).map(([code, a]) => ({ code, issuer: a.issuer, distributor: a.distributor }));
  const lista = contas.map((c) => `${c.code}: issuer ${c.issuer}, distributor ${c.distributor}`).join(' | ');
  if (opts.issuerEsperado || opts.distributorEsperado) {
    const erradas = contas.filter(
      (c) =>
        (opts.issuerEsperado && c.issuer !== opts.issuerEsperado) ||
        (opts.distributorEsperado && c.distributor !== opts.distributorEsperado),
    );
    if (erradas.length > 0) {
      add('contas-da-plina', 'falhou', `contas do arquivo ≠ contas esperadas da Plina (issuer esperado ${opts.issuerEsperado ?? '—'}, distributor esperado ${opts.distributorEsperado ?? '—'}); no arquivo: ${lista}`);
    } else {
      add('contas-da-plina', 'ok', `contas do arquivo = as esperadas da Plina (${lista})`);
    }
  }
  if (!opts.issuerEsperado || !opts.distributorEsperado) {
    add('contas-da-plina-fixadas', 'nao_conferido', `issuer/distributor da Plina NÃO foram fixados (use --issuer e --distributor, ou STELLAR_ISSUER_PUBLIC/STELLAR_DISTRIBUTOR_PUBLIC): um arquivo forjado com contas de terceiros também conferiria. Contas no arquivo: ${lista}`);
  }
  add('numerador', 'ok', `o numerador (cotas + caixa) NÃO está no Horizon: é a declaração da Plina (${arq.numerador.fonte ?? "fonte não declarada neste arquivo"}); aqui só a soma é conferida contra o próprio arquivo`);

  // 2. A âncora: memo hash da tx do distributor = SHA-256 do arquivo.
  const memoB64 = Buffer.from(sha256, 'hex').toString('base64');
  const txs = (await leitor.buscarPorMemo(classe.distributor, memoB64)).filter(
    (t) => t.successful && t.source_account === classe.distributor && t.memo_type === 'hash' && t.memo === memoB64,
  );
  if (txs.length === 0) add('ancora', 'falhou', `nenhuma tx do distributor ${classe.distributor} com Memo.hash = SHA-256 do arquivo`);
  else if (opts.txHash && !txs.some((t) => t.hash === opts.txHash)) {
    add('ancora', 'falhou', `a tx ${opts.txHash} não tem esse memo (âncora(s) achada(s): ${txs.map((t) => t.hash).join(', ')})`);
  } else {
    add('ancora', 'ok', `tx ${txs[0].hash} (${txs[0].created_at}): Memo.hash = SHA-256 do arquivo, source = distributor`);
    if (txs.length > 1) add('ancora-unica', 'nao_conferido', `${txs.length} âncoras com o mesmo hash (inofensivo, mas operador confere)`);
  }

  // 3. O NAV refeito só com o conteúdo do arquivo (sem confiar em total pré-somado).
  const r = recalcularNav(arq);
  const divergencias: string[] = [];
  if (f7(r.numerador) !== arq.numerador.total) divergencias.push(`numerador ${f7(r.numerador)} ≠ ${arq.numerador.total}`);
  if (r.regra !== arq.nav.regra) divergencias.push(`regra ${r.regra} ≠ ${arq.nav.regra}`);
  if (f7(r.denominador) !== arq.nav.denominador) divergencias.push(`denominador ${f7(r.denominador)} ≠ ${arq.nav.denominador}`);
  if (f8(r.porToken) !== arq.nav.porToken) divergencias.push(`NAV/token ${f8(r.porToken)} ≠ ${arq.nav.porToken}`);
  if ((r.porTokenSobreCirculante ? f8(r.porTokenSobreCirculante) : null) !== arq.nav.porTokenSobreCirculante) {
    divergencias.push('NAV sobre o circulante diverge');
  }
  if (r.regra === 'NAV_INICIAL' && r.numerador.gt(0)) divergencias.push('NAV inicial (R$ 1,00) com ativo > 0: inconsistência');
  const somaCotas = arq.numerador.cotasAtivas.itens.reduce((s, i) => s.plus(i.valorMarcado), D(0));
  if (somaCotas.toFixed(2) !== arq.numerador.cotasAtivas.valorMarcado) divergencias.push('soma das cotas ≠ valorMarcado');
  if (divergencias.length > 0) add('nav-do-arquivo', 'falhou', divergencias.join('; '));
  else add('nav-do-arquivo', 'ok', `NAV/token ${arq.nav.porToken} = numerador ${arq.numerador.total} ÷ denominador ${arq.nav.denominador} (${arq.nav.regra})`);

  // 4. O circulante e a conciliação refeitos no Horizon (só leitura).
  const agora = await leitor.ledgerAtual();
  const passou = agora.ledger > arq.horizon.ledgerFinal;
  add(
    'horizon-ledger',
    'ok',
    `arquivo lido nos ledgers ${arq.horizon.ledger}–${arq.horizon.ledgerFinal}; Horizon agora no ledger ${agora.ledger} (${agora.fechadoEm})`,
  );
  for (const code of Object.keys(arq.circulante).sort()) {
    const a = arq.circulante[code];
    const [emitido, dist, trust] = await Promise.all([
      leitor.totalEmitido(code, a.issuer),
      leitor.saldoDaConta(a.distributor, code, a.issuer),
      leitor.trustlinesAutorizadas(code, a.issuer, a.distributor),
    ]);
    const circ = emitido.minus(dist); // saldo do issuer: o Horizon exclui o issuer do /assets
    const difs: string[] = [];
    const cmp = (nome: string, vivo: string, arquivo: string) => vivo !== arquivo && difs.push(`${nome}: Horizon ${vivo} ≠ arquivo ${arquivo}`);
    cmp('totalEmitido', f7(emitido), a.totalEmitido);
    cmp('saldoDistributor', f7(dist), a.saldoDistributor);
    cmp('circulante', f7(circ), a.circulante);
    cmp('Σ trustlines autorizadas', f7(trust.soma), a.trustlinesAutorizadas.soma);
    if (trust.contas !== a.trustlinesAutorizadas.contas) difs.push(`contas: Horizon ${trust.contas} ≠ arquivo ${a.trustlinesAutorizadas.contas}`);
    if (difs.length === 0) {
      add(`horizon-${code}`, 'ok', `${code}: emitido ${f7(emitido)} − issuer 0 − distributor ${f7(dist)} = circulante ${f7(circ)}; Σ ${trust.contas} trustlines autorizadas = ${f7(trust.soma)}`);
    } else if (passou) {
      add(`horizon-${code}`, 'nao_conferido', `${code}: os saldos mudaram depois do snapshot (ledger ${agora.ledger} > ${arq.horizon.ledgerFinal}); o Horizon não guarda saldo histórico. Diferenças: ${difs.join(' | ')}`);
    } else {
      add(`horizon-${code}`, 'falhou', `${code}: ${difs.join(' | ')}`);
    }
    // A conciliação do arquivo tem de bater com a soma refeita (independente do tempo): faz sentido dentro do arquivo.
    const interna = D(a.trustlinesAutorizadas.soma).eq(a.circulante);
    if (!interna) add(`conciliacao-${code}`, 'falhou', `${code}: Σ trustlines (${a.trustlinesAutorizadas.soma}) ≠ circulante (${a.circulante}) dentro do próprio arquivo`);
    else add(`conciliacao-${code}`, 'ok', `${code}: Σ trustlines autorizadas = circulante no arquivo`);
  }
  return fim();
}
