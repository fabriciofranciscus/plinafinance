/**
 * Orquestra a exportação dos 2 registros canônicos (L2): lê a cota no banco (SÓ leitura), prepara os arquivos (hash,
 * varredura de dado pessoal, operador), confere o memo na rede e SÓ ENTÃO grava os bytes exatos em `destino`. Qualquer
 * recusa = nenhum arquivo daquele registro. Sem dado pessoal na saída. O CLI (scripts/exportar-registros-canonicos.ts) só
 * carrega o ambiente e chama isto.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  conferirMemoNaRede,
  prepararIncorporacao,
  prepararValidacao,
  type PessoaParaVarredura,
  type RegistroPreparado,
} from './registros-canonicos';

type Db = Pick<PrismaClient, 'cota' | 'eventoAudit' | 'cessao'>;

export interface LinhaExportada {
  registro: 'validacao' | 'incorporacao';
  ok: boolean;
  motivo?: string;
  arquivo?: string;
  sha256?: string;
  txHash?: string | null;
}

export interface ResultadoExportacao {
  cotaId: string;
  linhas: LinhaExportada[];
  /** Todos os registros prontos e conferidos na rede. */
  tudoOk: boolean;
  pasta: string;
}

export async function exportarRegistros(i: {
  cotaId: string;
  db: Db;
  fetchFn: typeof fetch;
  horizonUrl: string;
  destinoBase: string;
}): Promise<ResultadoExportacao> {
  const cota = await i.db.cota.findUnique({
    where: { id: i.cotaId },
    select: { id: true, cessaoId: true, hashValidacao: true, validacaoTxHash: true },
  });
  if (!cota) throw new Error(`Cota ${i.cotaId} não encontrada.`);

  // Quem é o cedente (para a varredura procurar): vem do banco e nunca é impresso.
  const pessoa: PessoaParaVarredura = { nomes: [], documentos: [], emails: [] };
  if (cota.cessaoId) {
    const c = await i.db.cessao.findUnique({
      where: { id: cota.cessaoId },
      select: { oferta: { select: { leadVendedor: { select: { nome: true, email: true, cpf: true, pessoa: { select: { nome: true, email: true, cpfNormalizado: true } } } } } } },
    });
    const lead = c?.oferta?.leadVendedor;
    for (const v of [lead?.nome, lead?.pessoa?.nome]) if (v) pessoa.nomes.push(v);
    for (const v of [lead?.cpf, lead?.pessoa?.cpfNormalizado]) if (v) pessoa.documentos.push(v);
    for (const v of [lead?.email, lead?.pessoa?.email]) if (v) pessoa.emails.push(v);
  }

  const laudo = cota.hashValidacao
    ? await i.db.eventoAudit.findFirst({ where: { acao: 'COTA_VALIDADA', payloadHash: cota.hashValidacao }, select: { payloadJson: true, payloadHash: true } })
    : null;
  const incorporacao = await i.db.eventoAudit.findFirst({
    where: { cotaId: cota.id, acao: 'COTA_INCORPORADA' },
    select: { payloadJson: true, payloadHash: true },
  });

  const pasta = join(i.destinoBase, `registros-canonicos-${cota.id}`);
  const preparados: Array<['validacao' | 'incorporacao', RegistroPreparado]> = [
    ['validacao', prepararValidacao({ cota, laudo }, pessoa)],
    ['incorporacao', prepararIncorporacao({ cota: { id: cota.id }, incorporacao }, pessoa)],
  ];

  const linhas: LinhaExportada[] = [];
  const manifesto: Array<Record<string, unknown>> = [];
  for (const [registro, p] of preparados) {
    if (!p.ok || !p.bytes || !p.sha256 || !p.nomeDoArquivo) {
      linhas.push({ registro, ok: false, motivo: p.motivo ?? 'RECUSADO' });
      continue;
    }
    const memo = p.memoEsperadoDe ? await conferirMemoNaRede(i.fetchFn, i.horizonUrl, p.memoEsperadoDe, p.sha256) : { ok: false, motivo: 'SEM_TX' };
    if (!memo.ok) {
      linhas.push({ registro, ok: false, motivo: memo.motivo ?? 'MEMO_NAO_CONFERE', sha256: p.sha256, txHash: p.memoEsperadoDe });
      continue;
    }
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, p.nomeDoArquivo), p.bytes); // os BYTES exatos, sem reformatar
    linhas.push({ registro, ok: true, arquivo: p.nomeDoArquivo, sha256: p.sha256, txHash: p.memoEsperadoDe });
    manifesto.push({ registro, arquivo: p.nomeDoArquivo, sha256: p.sha256, txHash: p.memoEsperadoDe, memoConfere: true, ocorrenciasDePessoa: p.varredura?.total ?? 0 });
  }
  if (manifesto.length > 0) writeFileSync(join(pasta, 'manifesto.json'), JSON.stringify({ cotaId: cota.id, registros: manifesto }, null, 2));
  return { cotaId: cota.id, linhas, tudoOk: linhas.length === 2 && linhas.every((l) => l.ok), pasta };
}
