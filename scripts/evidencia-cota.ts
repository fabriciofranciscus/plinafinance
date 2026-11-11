/**
 * E1-P — evidência da cota: `pnpm evidencia:cota <cotaId>`.
 *
 * Lista em ordem validação → cessão → liquidação → incorporação → emissão, com link do explorer,
 * documento e SHA-256 de cada passo, e CONFERE sha256(documento guardado) == hash no banco ==
 * Memo.hash on-chain. Só leitura. Só testnet (recusa PUBLIC). Sai com código 1 se algum passo não fecha.
 * Saída: exports/evidencia-cota-<id>.{md,json} (gitignored) + tabela no terminal.
 *
 * Pathnames do Blob (sobrescreva com env se o dono mudar): EVIDENCIA_BLOB_CESSAO_PATH, EVIDENCIA_BLOB_COMPROVANTE_PATH
 * (use {cessaoId}). Padrões: DS3 `cessoes/{cessaoId}/assinada.pdf`; E1-2 `comprovantes/{cessaoId}.pdf`.
 */
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from '@vercel/blob';
import { montarEvidencia, paraMarkdown, type Fontes, type TxLida } from './evidencia-cota/core';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

async function lerBlob(pathname: string): Promise<Buffer | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const r = await get(pathname, { access: 'private' });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  } catch (err) {
    if (err instanceof Error && /not.?found/i.test(`${err.name} ${err.message}`)) return null;
    throw err;
  }
}

async function main() {
  const cotaId = process.argv[2];
  if (!cotaId) throw new Error('Uso: pnpm evidencia:cota <cotaId>');

  // Imports tardios: dependem do .env já carregado.
  const { STELLAR_NETWORK, horizonUrl } = await import('../lib/stellar/config');
  if (STELLAR_NETWORK !== 'TESTNET') throw new Error('Recusado: evidência só roda contra TESTNET.');
  const { db } = await import('../lib/db');
  const { sha256OfPayload } = await import('../lib/stellar/audit');

  const caminho = (env: string | undefined, padrao: string, id: string) => (env ?? padrao).replace('{cessaoId}', id);

  const fontes: Fontes = {
    hashPayload: sha256OfPayload,
    async cota(id) {
      const c = await db.cota.findUnique({ where: { id } });
      return c && {
        id: c.id, cessaoId: c.cessaoId, hashValidacao: c.hashValidacao, validacaoTxHash: c.validacaoTxHash,
        emissaoTxHash: c.emissaoTxHash, tokensEmitidos: c.tokensEmitidos.toString(),
      };
    },
    laudo: (h) =>
      db.eventoAudit.findFirst({ where: { acao: 'COTA_VALIDADA', payloadHash: h }, select: { payloadJson: true, payloadHash: true } }),
    cessao: (id) => db.cessao.findUnique({ where: { id }, select: { status: true, hashDocumento: true, onChainTxHash: true } }),
    pdfCessao: (id) => lerBlob(caminho(process.env.EVIDENCIA_BLOB_CESSAO_PATH, 'cessoes/{cessaoId}/assinada.pdf', id)),
    pagamento: (id) => db.pagamento.findUnique({ where: { cessaoId: id }, select: { status: true, onChainTxHash: true } }),
    comprovante: (id) => lerBlob(caminho(process.env.EVIDENCIA_BLOB_COMPROVANTE_PATH, 'comprovantes/{cessaoId}.pdf', id)),
    async aporte(id) {
      const m = await db.movimentoFundo.findFirst({ where: { cotaId: id, tipo: 'APORTE_COTA' } });
      return m && { txHash: m.txHash, hashValidacao: m.hashValidacao, valorBrl: m.valorBrl.toString(), navPorToken: m.navPorToken?.toString() ?? null };
    },
    async tx(hash): Promise<TxLida | null> {
      const res = await fetch(`${horizonUrl}/transactions/${hash}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Horizon ${res.status} ao ler a tx ${hash}`); // nunca vira "não achou"
      const j = (await res.json()) as { successful: boolean; memo_type?: string; memo?: string };
      const memoHex = j.memo_type === 'hash' && j.memo ? Buffer.from(j.memo, 'base64').toString('hex') : null;
      return { sucesso: j.successful === true, memoHex };
    },
  };

  const ev = await montarEvidencia(cotaId, fontes);
  mkdirSync('exports', { recursive: true });
  writeFileSync(`exports/evidencia-cota-${cotaId}.json`, JSON.stringify(ev, null, 2));
  writeFileSync(`exports/evidencia-cota-${cotaId}.md`, paraMarkdown(ev));
  console.log(paraMarkdown(ev));
  await db.$disconnect();
  if (!ev.todosConferem) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
