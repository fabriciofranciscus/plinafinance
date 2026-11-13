/**
 * E1-P — evidência da cota: `pnpm evidencia:cota <cotaId>`.
 *
 * Lista em ordem validação → cessão → liquidação → incorporação (registro canônico ancorado ANTES da emissão) → emissão (o pagamento que emitiu PLINA-RF), com link do explorer,
 * documento e SHA-256 de cada passo, e CONFERE sha256(documento guardado) == hash no banco ==
 * Memo.hash on-chain. Só leitura. Só testnet (recusa PUBLIC). Código de saída: 0 todos conferem; 2 conferem com
 * passo PENDENTE (funcionalidade fora desta base, sem nenhum artefato); 1 algum passo não fecha.
 * Saída: exports/evidencia-cota-<id>.{md,json} (gitignored) + tabela no terminal.
 *
 * Pathnames do Blob (sobrescreva com env se o dono mudar): EVIDENCIA_BLOB_CESSAO_PATH (use {cessaoId}) e
 * EVIDENCIA_BLOB_INCORPORACAO_PATH (use {cotaId}). Padrões: DS3 `cessoes/{cessaoId}/assinada.pdf`; E1-2: o comprovante
 * vem do banco (TransferenciaPix.comprovante + comprovanteSha256 + ancoraTxHash + e2eId), não do Blob; incorporação `cotas/{cotaId}/incorporacao.json` (Bento, ainda não publicado).
 * Incorporação: a tx da âncora é achada no histórico do distributor por Memo.hash = sha256(bytes) (sem confiar no banco);
 * o hash REGISTRADO no banco fica null até o Bento publicar o campo (fail-closed: reprova SEM_HASH_REGISTRADO).
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
  const { issuerSigner, distributorSigner } = await import('../lib/stellar/signer');
  const { assetCode } = await import('../lib/stellar/config');
  const { sha256Hex } = await import('./evidencia-cota/core');

  const caminho = (env: string | undefined, padrao: string, id: string) => (env ?? padrao).replace('{cessaoId}', id);

  const fontes: Fontes = {
    hashPayload: sha256OfPayload,
    ativo: () => ({ code: assetCode, issuer: issuerSigner().publicKey() }),
    async registroIncorporacao(cotaId) {
      const bytes = await lerBlob(caminho(process.env.EVIDENCIA_BLOB_INCORPORACAO_PATH, 'cotas/{cotaId}/incorporacao.json', cotaId).replace('{cotaId}', cotaId));
      if (!bytes) return null;
      // Âncora própria: payment do distributor com Memo.hash = sha256(bytes) (só leitura do histórico).
      const alvo = Buffer.from(sha256Hex(bytes), 'hex').toString('base64');
      const dist = distributorSigner().publicKey();
      let url: string | null = `${horizonUrl}/accounts/${dist}/transactions?order=desc&limit=200`;
      for (let pag = 0; url && pag < 5; pag++) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Horizon ${res.status} ao ler o histórico do distributor`);
        const j = (await res.json()) as { _embedded: { records: { hash: string; memo_type?: string; memo?: string }[] }; _links: { next: { href: string } } };
        const achou = j._embedded.records.find((r) => r.memo_type === 'hash' && r.memo === alvo);
        if (achou) return { bytes, hashRegistrado: null, txHash: achou.hash };
        url = j._embedded.records.length === 200 ? j._links.next.href : null;
      }
      return { bytes, hashRegistrado: null, txHash: null };
    },
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
    // Liquidação (E1-2, main): TransferenciaPix. Os BYTES canônicos do comprovante ficam no banco (fonte da verdade;
    // o Blob é espelho). Só os campos da prova: nunca destinoMascarado nem dados do titular (sem PII na saída).
    async pagamento(id) {
      const t = await db.transferenciaPix.findUnique({
        where: { cessaoId: id },
        select: { status: true, ancoraTxHash: true, comprovanteSha256: true, e2eId: true },
      });
      return t && { status: t.status, onChainTxHash: t.ancoraTxHash, hashComprovante: t.comprovanteSha256, e2eId: t.e2eId };
    },
    async comprovante(id) {
      const t = await db.transferenciaPix.findUnique({ where: { cessaoId: id }, select: { comprovante: true } });
      return t?.comprovante ? Buffer.from(t.comprovante, 'utf8') : null;
    },
    async aporte(id) {
      const m = await db.movimentoFundo.findFirst({ where: { cotaId: id, tipo: 'APORTE_COTA' } });
      return m && { txHash: m.txHash, hashValidacao: m.hashValidacao, valorBrl: m.valorBrl.toString(), navPorToken: m.navPorToken?.toString() ?? null };
    },
    async tx(hash): Promise<TxLida | null> {
      const res = await fetch(`${horizonUrl}/transactions/${hash}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Horizon ${res.status} ao ler a tx ${hash}`); // nunca vira "não achou"
      const j = (await res.json()) as { successful: boolean; memo_type?: string; memo?: string; paging_token?: string };
      const memoHex = j.memo_type === 'hash' && j.memo ? Buffer.from(j.memo, 'base64').toString('hex') : null;
      const ops = await fetch(`${horizonUrl}/transactions/${hash}/operations?limit=200`);
      if (!ops.ok) throw new Error(`Horizon ${ops.status} ao ler as operações da tx ${hash}`);
      const oj = (await ops.json()) as { _embedded: { records: { type: string; asset_type?: string; asset_code?: string; asset_issuer?: string; amount?: string; from?: string; to?: string }[] } };
      const pagamentos = oj._embedded.records
        .filter((o) => o.type === 'payment' && o.asset_type !== 'native' && o.asset_code && o.asset_issuer)
        .map((o) => ({ asset: `${o.asset_code}:${o.asset_issuer}`, amount: o.amount ?? '', from: o.from ?? '', to: o.to ?? '' }));
      return { sucesso: j.successful === true, memoHex, ordem: j.paging_token, pagamentos };
    },
  };

  // Nesta base (fabricio/main 4f337e8) o DS3 e o registro canônico da incorporação (E1-p) ainda não existem:
  // esses passos saem como PENDENTE se não houver nenhum artefato deles. Tire da lista quando entrarem.
  const ev = await montarEvidencia(cotaId, fontes, undefined, { pendentesNestaBase: ['CESSAO', 'INCORPORACAO'] });
  mkdirSync('exports', { recursive: true });
  writeFileSync(`exports/evidencia-cota-${cotaId}.json`, JSON.stringify(ev, null, 2));
  writeFileSync(`exports/evidencia-cota-${cotaId}.md`, paraMarkdown(ev));
  console.log(paraMarkdown(ev));
  await db.$disconnect();
  // 0 = todos conferem; 2 = conferem, com passo pendente; 1 = há passo sem prova.
  if (!ev.todosConferem) process.exit(ev.conferemExcetoPendentes ? 2 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
