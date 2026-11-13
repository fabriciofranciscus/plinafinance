/**
 * QA (Vera) — DS2 (envio da cessão ao DocuSign) e DS3 (conclusão: PDF → bytes guardados → SHA-256 → âncora → ASSINADA) com
 * Postgres REAL: claims por `updateMany` condicionado, concorrência, queda em cada passo, retomada e idempotência.
 * Mocks só de fora do banco: cliente DocuSign, Blob (em memória), âncora Stellar (idempotente por hash, como a real) e e-mail.
 *
 * Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db pnpm vitest run __tests__/services/cessao-docusign-pg.test.ts
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  process.env.DOCUSIGN_CONNECT_HMAC_KEY = 'chave-connect-de-teste-com-bastante-entropia';
  return url;
});

const ENV_ID = '11111111-2222-3333-4444-555555555555';
const st = vi.hoisted(() => ({
  statusEnvelope: 'concluido' as string,
  downloads: [] as number[],
  baixar: vi.fn(),
  obterStatus: vi.fn(),
  criar: vi.fn(),
  buscar: vi.fn(),
  ancora: vi.fn(),
  email: vi.fn(),
  blob: new Map<string, Buffer>(),
  blobFalha: null as null | 'put' | 'get',
  ancoras: new Map<string, string>(),
  seq: 0,
  rede: 'TESTNET',
  pdf: vi.fn(),
}));

vi.mock('@/lib/integrations/docusign', async (orig) => {
  const m = await orig<typeof import('@/lib/integrations/docusign')>();
  return { ...m, baixarDocumentoAssinado: st.baixar, obterStatusEnvelope: st.obterStatus, criarEnvelope: st.criar, buscarEnvelopePorTransactionId: st.buscar };
});
vi.mock('@/lib/comprovante/cessao-store', () => ({
  lerCessaoAssinada: async (id: string) => { if (st.blobFalha === 'get') throw new Error('blob get falhou'); return st.blob.get(id) ?? null; },
  guardarCessaoAssinada: async (id: string, b: Buffer) => { if (st.blobFalha === 'put') throw new Error('blob put falhou'); if (st.blob.has(id)) throw new Error('já existe (allowOverwrite:false)'); st.blob.set(id, Buffer.from(b)); return `cessoes/${id}/assinada.pdf`; },
}));
vi.mock('@/lib/comprovante/cessao-pdf', async (orig) => ({ ...(await orig<typeof import('@/lib/comprovante/cessao-pdf')>()), buildCessaoPdf: st.pdf }));
vi.mock('@/lib/stellar/config', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/config')>()), get STELLAR_NETWORK() { return st.rede; } }));
vi.mock('@/lib/stellar/ancora', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/ancora')>()), ancorarSha256: st.ancora }));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: st.email }));

import { createHash, createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { DocusignError } from '@/lib/integrations/docusign';
import { CONCLUSAO_JANELA_MS, processarEnvelopeDocusign, sincronizarCessoesDocusign } from '@/lib/services/cessao-assinatura';
import { DOCUSIGN_ENVIO_JANELA_MS, EnvioDocusignEmAndamentoError, EnvioDocusignLaudoAusenteError, enviarCessaoParaAssinatura, transactionIdDaCessao } from '@/lib/services/cessao-docusign';

const LIMPAR = 'TRUNCATE "EventoAudit", "Cessao", "Oferta", "LeadVendedor" RESTART IDENTITY CASCADE';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PDF = Buffer.from('%PDF-assinado-pelo-cedente');
let seq = 0;

async function semear(over: { status?: 'PENDENTE' | 'ENVIADA_DOCUSIGN' | 'ASSINADA' | 'CANCELADA' | 'EXPIRADA'; envelope?: boolean; email?: string | null; criadaEm?: Date } = {}) {
  seq += 1;
  const lead = await db.leadVendedor.create({ data: { nome: 'Cedente de Teste', email: over.email === null ? `lead${seq}@plina.test` : (over.email ?? `lead${seq}@plina.test`) } });
  const oferta = await db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '100000.00', administradora: 'Adm Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '80000.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
  const status = over.status ?? 'ENVIADA_DOCUSIGN';
  const cessao = await db.cessao.create({ data: { ofertaId: oferta.id, status, ...(over.envelope === false || status === 'PENDENTE' ? {} : { docusignEnvelopeId: ENV_ID }), ...(over.criadaEm ? { criadaEm: over.criadaEm } : {}) } });
  return { leadId: lead.id, ofertaId: oferta.id, cessaoId: cessao.id };
}
const linha = (id: string) => db.cessao.findUniqueOrThrow({ where: { id } });
const audits = (cessaoId: string, acao?: string) => db.eventoAudit.count({ where: { cessaoId, ...(acao ? { acao: acao as never } : {}) } });
const erro = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error | null;
const hmac = (corpo: string, chave = process.env.DOCUSIGN_CONNECT_HMAC_KEY!) => createHmac('sha256', chave).update(corpo).digest('base64');
const chamarWebhook = async (corpo: string, headers: Record<string, string> = { 'x-docusign-signature-1': hmac(corpo) }) => {
  const { POST } = await import('@/app/api/webhooks/docusign/route');
  const r = await POST(new Request('http://x/api/webhooks/docusign', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: corpo }));
  return { status: r.status, texto: await r.text() };
};

describe.skipIf(!PG)('DS2/DS3 — cessão no DocuSign, conclusão e âncora (Postgres real)', () => {
  afterEach(async () => { await db.$executeRawUnsafe(LIMPAR); vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.statusEnvelope = 'concluido'; st.blob = new Map(); st.blobFalha = null; st.ancoras = new Map(); st.seq = 0; st.downloads = [];
    st.obterStatus.mockReset().mockImplementation(async () => st.statusEnvelope);
    st.baixar.mockReset().mockImplementation(async () => { st.downloads.push(Date.now()); return Buffer.from(st.downloads.length === 1 ? PDF : Buffer.concat([PDF, Buffer.from(`-2o-download-${st.downloads.length}`)])); });
    st.ancora.mockReset().mockImplementation(async ({ sha256Hex }: { sha256Hex: string }) => {
      const ja = st.ancoras.get(sha256Hex);
      if (ja) return { txHash: ja, reutilizada: true, ledgerCloseTime: '2026-11-13T12:00:00Z' };
      const tx = (++st.seq).toString(16).padStart(64, '0'); st.ancoras.set(sha256Hex, tx);
      return { txHash: tx, reutilizada: false, ledgerCloseTime: '2026-11-13T12:00:00Z' };
    });
    st.email.mockReset().mockResolvedValue(true);
    st.rede = 'TESTNET'; st.pdf.mockReset().mockResolvedValue(Buffer.from('%PDF-fake-nao-assinado'));
    st.criar.mockReset().mockResolvedValue({ envelopeId: ENV_ID });
    st.buscar.mockReset().mockResolvedValue(null);
    await db.$executeRawUnsafe(LIMPAR);
  });

  describe('DS3 — processarEnvelopeDocusign', () => {
    it('caminho feliz: ASSINADA com hashDocumento = SHA-256 dos bytes GUARDADOS, âncora (DOCUSIGN_PDF, desde = Cessao.criadaEm) com esse hash, audit com payloadHash = hash e stellarTxHash, lead CESSAO_ASSINADA, 1 e-mail', async () => {
      const s = await semear();
      const c0 = await linha(s.cessaoId);
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r).toMatchObject({ resultado: 'ASSINADA', cessaoId: s.cessaoId, hashDocumento: sha(PDF) });
      const c = await linha(s.cessaoId);
      expect(c).toMatchObject({ status: 'ASSINADA', hashDocumento: sha(PDF), onChainTxHash: r.txHash });
      expect(c.assinadaEm).not.toBeNull();
      expect(st.ancora).toHaveBeenCalledTimes(1);
      const arg = st.ancora.mock.calls[0][0] as { sha256Hex: string; contexto: string; desde: Date };
      expect(arg).toMatchObject({ sha256Hex: sha(PDF), contexto: 'DOCUSIGN_PDF' });
      expect(arg.desde.getTime()).toBe(c0.criadaEm.getTime());
      const ev = await db.eventoAudit.findFirstOrThrow({ where: { cessaoId: s.cessaoId, acao: 'CESSAO_ASSINADA' } });
      expect(ev).toMatchObject({ payloadHash: sha(PDF), stellarTxHash: r.txHash });
      expect((await db.leadVendedor.findUniqueOrThrow({ where: { id: s.leadId } })).status).toBe('CESSAO_ASSINADA');
      expect(st.email).toHaveBeenCalledTimes(1);
      expect(st.blob.get(s.cessaoId)?.equals(PDF)).toBe(true);
    });

    it('REENTREGA depois de ASSINADA: JA_ASSINADA sem download, sem âncora, sem 2º audit nem 2º e-mail', async () => {
      const s = await semear();
      await processarEnvelopeDocusign(ENV_ID);
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r.resultado).toBe('JA_ASSINADA');
      expect(st.baixar).toHaveBeenCalledTimes(1); expect(st.ancora).toHaveBeenCalledTimes(1);
      expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(1); expect(st.email).toHaveBeenCalledTimes(1);
    });

    it('5 conclusões SIMULTÂNEAS: UMA assina e ancora; as outras 4 recebem EM_ANDAMENTO/JA_ASSINADA; 1 download, 1 âncora, 1 audit', async () => {
      const s = await semear();
      const rs = await Promise.all(Array.from({ length: 5 }, () => processarEnvelopeDocusign(ENV_ID).catch((e) => ({ resultado: `ERRO:${(e as Error).message}` }))));
      expect(rs.filter((r) => r.resultado === 'ASSINADA')).toHaveLength(1);
      for (const r of rs.filter((x) => x.resultado !== 'ASSINADA')) expect(['EM_ANDAMENTO', 'JA_ASSINADA']).toContain(r.resultado);
      expect(st.baixar).toHaveBeenCalledTimes(1); expect(st.ancora).toHaveBeenCalledTimes(1);
      expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(1);
      expect((await linha(s.cessaoId)).status).toBe('ASSINADA');
    });

    it('QUEDA depois de guardar o PDF e ANTES de gravar o hash (a atualização do hash falha): o claim é liberado; a retomada lê os bytes GUARDADOS e NÃO baixa de novo — o hash vem do 1º download mesmo que o 2º seja diferente', async () => {
      const s = await semear();
      const real = db.cessao.updateMany.bind(db.cessao);
      let falhou = false;
      vi.spyOn(db.cessao, 'updateMany').mockImplementation(((args: { data?: { hashDocumento?: string } }) => {
        if (!falhou && args?.data && 'hashDocumento' in args.data && Object.keys(args.data).length === 1) { falhou = true; return Promise.reject(new Error('queda gravando o hash')); }
        return real(args as never);
      }) as never);
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/queda gravando o hash/);
      expect((await linha(s.cessaoId)).docusignConclusaoIniciadaEm).toBeNull(); // claim liberado
      expect(st.blob.has(s.cessaoId)).toBe(true);
      vi.restoreAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r).toMatchObject({ resultado: 'ASSINADA', hashDocumento: sha(PDF) });
      expect(st.baixar).toHaveBeenCalledTimes(1);
    });

    it('QUEDA entre o hash e a âncora (a âncora falha): claim liberado, hash gravado e estável; a repetição ancora o MESMO hash e conclui', async () => {
      const s = await semear();
      st.ancora.mockRejectedValueOnce(new Error('horizon indisponível'));
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/horizon/);
      const c1 = await linha(s.cessaoId);
      expect(c1).toMatchObject({ status: 'ENVIADA_DOCUSIGN', hashDocumento: sha(PDF), docusignConclusaoIniciadaEm: null });
      expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(0);
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r.resultado).toBe('ASSINADA');
      expect((st.ancora.mock.calls[1][0] as { sha256Hex: string }).sha256Hex).toBe(sha(PDF));
      expect(st.baixar).toHaveBeenCalledTimes(1);
    });

    it('QUEDA entre a âncora e ASSINADA (a transação final rejeita): a retomada acha a âncora pelo hash (UMA tx na rede) e conclui; nada duplicado', async () => {
      const s = await semear();
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('conexão caiu depois da âncora'));
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/conexão caiu/);
      expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
      vi.restoreAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r.resultado).toBe('ASSINADA');
      expect(st.ancoras.size).toBe(1); // uma tx on-chain só
      expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(1);
    });

    it('cessão CANCELADA (ação do operador) DURANTE a âncora de ~130 s NÃO é revertida para ASSINADA: a transação final recusa ("mudou de estado"), nada é gravado (sem audit, lead intacto) e o claim some', async () => {
      const s = await semear();
      st.ancora.mockImplementationOnce(async ({ sha256Hex }: { sha256Hex: string }) => {
        await db.cessao.update({ where: { id: s.cessaoId }, data: { status: 'CANCELADA' } }); // o operador cancela enquanto a âncora corre
        st.ancoras.set(sha256Hex, 'a'.repeat(64));
        return { txHash: 'a'.repeat(64), reutilizada: false, ledgerCloseTime: '2026-11-13T12:00:00Z' };
      });
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/mudou de estado/);
      expect(await linha(s.cessaoId)).toMatchObject({ status: 'CANCELADA', onChainTxHash: null });
      expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(0);
      expect((await db.leadVendedor.findUniqueOrThrow({ where: { id: s.leadId } })).status).not.toBe('CESSAO_ASSINADA');
      expect(st.email).not.toHaveBeenCalled();
    });

    it('Blob falha ao GUARDAR: nada é ancorado nem marcado ASSINADA, claim liberado; com o Blob de volta conclui (o 1º download é o que vale)', async () => {
      const s = await semear();
      st.blobFalha = 'put';
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/blob put falhou/);
      expect(st.ancora).not.toHaveBeenCalled();
      expect(await linha(s.cessaoId)).toMatchObject({ status: 'ENVIADA_DOCUSIGN', hashDocumento: null, docusignConclusaoIniciadaEm: null });
      st.blobFalha = null;
      expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('ASSINADA');
    });

    it('Blob falha ao LER: erro propaga (não baixa de novo às cegas, não ancora) e o claim é liberado', async () => {
      const s = await semear();
      st.blobFalha = 'get';
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/blob get falhou/);
      expect(st.baixar).not.toHaveBeenCalled(); expect(st.ancora).not.toHaveBeenCalled();
      expect((await linha(s.cessaoId)).docusignConclusaoIniciadaEm).toBeNull();
    });

    it(`claim: recente (< ${CONCLUSAO_JANELA_MS / 1000} s) BLOQUEIA (EM_ANDAMENTO, sem download nem âncora); velho (> janela, processo morreu) é ASSUMIDO e conclui`, async () => {
      const s = await semear();
      await db.cessao.update({ where: { id: s.cessaoId }, data: { docusignConclusaoIniciadaEm: new Date(Date.now() - (CONCLUSAO_JANELA_MS - 30_000)) } });
      expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('EM_ANDAMENTO');
      expect(st.baixar).not.toHaveBeenCalled(); expect(st.ancora).not.toHaveBeenCalled();
      await db.cessao.update({ where: { id: s.cessaoId }, data: { docusignConclusaoIniciadaEm: new Date(Date.now() - (CONCLUSAO_JANELA_MS + 1_000)) } });
      expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('ASSINADA');
    });

    it('a janela do claim é ≥ 300 s (a âncora leva ~130 s: o claim tem de durar mais que ela)', () => { expect(CONCLUSAO_JANELA_MS).toBeGreaterThanOrEqual(300_000); });

    it('envelope NÃO concluído (enviado/entregue/assinado/…): AGUARDANDO, sem claim, sem download, sem âncora', async () => {
      const s = await semear();
      for (const status of ['enviado', 'entregue', 'assinado', 'criado']) {
        st.statusEnvelope = status;
        expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('AGUARDANDO');
      }
      expect(st.baixar).not.toHaveBeenCalled(); expect(st.ancora).not.toHaveBeenCalled();
      expect((await linha(s.cessaoId)).docusignConclusaoIniciadaEm).toBeNull();
    });

    it('recusado/anulado: CANCELADA + 1 audit CESSAO_RECUSADA_DOCUSIGN (também com 3 chamadas simultâneas), sem âncora; depois disso o envelope "concluído" não reabre a cessão', async () => {
      const s = await semear();
      st.statusEnvelope = 'recusado';
      const rs = await Promise.all([1, 2, 3].map(() => processarEnvelopeDocusign(ENV_ID)));
      expect(rs.every((r) => r.resultado === 'CANCELADA')).toBe(true);
      expect((await linha(s.cessaoId)).status).toBe('CANCELADA');
      expect(await audits(s.cessaoId, 'CESSAO_RECUSADA_DOCUSIGN')).toBe(1);
      st.statusEnvelope = 'concluido';
      expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('CANCELADA');
      expect(st.ancora).not.toHaveBeenCalled();
      expect((await linha(s.cessaoId)).status).toBe('CANCELADA');
    });

    it('envelope desconhecido → DESCONHECIDA sem tocar em nada; cessão PENDENTE/CANCELADA/EXPIRADA → CANCELADA (não conclui) sem download nem âncora', async () => {
      expect((await processarEnvelopeDocusign('99999999-2222-3333-4444-555555555555')).resultado).toBe('DESCONHECIDA');
      for (const status of ['PENDENTE', 'EXPIRADA'] as const) {
        const s = await semear({ status, envelope: true });
        await db.cessao.update({ where: { id: s.cessaoId }, data: { docusignEnvelopeId: `aaaaaaaa-0000-0000-0000-${String(seq).padStart(12, '0')}` } });
        const env = (await linha(s.cessaoId)).docusignEnvelopeId!;
        expect((await processarEnvelopeDocusign(env)).resultado).toBe('CANCELADA');
      }
      expect(st.baixar).not.toHaveBeenCalled(); expect(st.ancora).not.toHaveBeenCalled();
    });

    it('o hash NUNCA vem do 2º download: com o PDF já guardado e hashDocumento nulo (retomada), o hash é dos bytes guardados mesmo que o DocuSign devolva outros bytes', async () => {
      const s = await semear();
      st.blob.set(s.cessaoId, Buffer.from(PDF)); // bytes de uma tentativa anterior
      st.baixar.mockResolvedValue(Buffer.from('OUTROS-BYTES-DO-2O-DOWNLOAD'));
      const r = await processarEnvelopeDocusign(ENV_ID);
      expect(r.hashDocumento).toBe(sha(PDF));
      expect(st.baixar).not.toHaveBeenCalled();
    });

    it('o EventoAudit e o retorno não carregam PII (nome/e-mail do cedente) nem o conteúdo do PDF', async () => {
      const s = await semear();
      const r = await processarEnvelopeDocusign(ENV_ID);
      const evs = await db.eventoAudit.findMany({ where: { cessaoId: s.cessaoId } });
      const dump = JSON.stringify([r, evs]);
      for (const proibido of ['Cedente de Teste', '@plina.test', 'assinado-pelo-cedente']) expect(dump).not.toContain(proibido);
    });

    it('e-mail ao cedente que falha DEPOIS de ASSINADA: o erro propaga (500 no webhook), mas a cessão fica ASSINADA e a reentrega vira JA_ASSINADA — o e-mail não é reenviado (limitação: best-effort)', async () => {
      const s = await semear();
      st.email.mockRejectedValueOnce(new Error('smtp caiu'));
      expect((await erro(processarEnvelopeDocusign(ENV_ID)))?.message).toMatch(/smtp/);
      expect((await linha(s.cessaoId)).status).toBe('ASSINADA');
      expect((await processarEnvelopeDocusign(ENV_ID)).resultado).toBe('JA_ASSINADA');
      expect(st.email).toHaveBeenCalledTimes(1);
    });
  });

  describe('sincronizarCessoesDocusign (polling de fallback do /admin)', () => {
    it('reconcilia só ENVIADA_DOCUSIGN com envelope; uma que falha vira ERRO sem vazar a causa e não impede as demais; limite máximo 50', async () => {
      const a = await semear(); const b = await semear();
      await db.cessao.update({ where: { id: b.cessaoId }, data: { docusignEnvelopeId: '22222222-2222-3333-4444-555555555555' } });
      await semear({ status: 'PENDENTE' }); await semear({ status: 'ASSINADA' });
      st.obterStatus.mockImplementation(async (id: string) => { if (id.startsWith('2222')) throw new Error('segredo-na-mensagem-do-erro'); return 'concluido'; });
      const r = await sincronizarCessoesDocusign({ limite: 500 });
      expect(r.processadas).toBe(2);
      expect(r.resultados.find((x) => x.cessaoId === a.cessaoId)?.resultado).toBe('ASSINADA');
      expect(r.resultados.find((x) => x.cessaoId === b.cessaoId)?.resultado).toBe('ERRO');
      expect(JSON.stringify(r)).not.toContain('segredo');
      expect(await sincronizarCessoesDocusign({ cessaoId: 'nao_existe' })).toEqual({ processadas: 0, resultados: [] });
    });
  });

  describe('webhook POST /api/webhooks/docusign (HMAC, replay, fail-closed)', () => {
    const corpo = (id = ENV_ID) => JSON.stringify({ event: 'envelope-completed', data: { envelopeId: id } });
    it('HMAC válido → 200 e conclui a cessão; REENTREGA do mesmo corpo → 200 JA_ASSINADA, sem reprocessar (1 âncora)', async () => {
      const s = await semear();
      const c = corpo();
      const r1 = await chamarWebhook(c); expect(r1.status).toBe(200); expect(JSON.parse(r1.texto).data).toMatchObject({ received: true, resultado: 'ASSINADA' });
      const r2 = await chamarWebhook(c); expect(r2.status).toBe(200); expect(JSON.parse(r2.texto).data.resultado).toBe('JA_ASSINADA');
      expect(st.ancora).toHaveBeenCalledTimes(1);
      expect((await linha(s.cessaoId)).status).toBe('ASSINADA');
    });
    it('sem assinatura, assinatura errada, corpo adulterado depois de assinado ou assinatura de OUTRA chave → 401 sem tocar em nada e sem ecoar o corpo', async () => {
      const s = await semear(); const c = corpo();
      for (const h of [{}, { 'x-docusign-signature-1': 'AAAA' }, { 'x-docusign-signature-1': hmac(c, 'outra-chave-qualquer') }]) {
        const r = await chamarWebhook(c, h as Record<string, string>);
        expect(r.status).toBe(401); expect(r.texto).not.toContain(ENV_ID);
      }
      const adulterado = await chamarWebhook(c.replace('completed', 'completEd'), { 'x-docusign-signature-1': hmac(c) });
      expect(adulterado.status).toBe(401);
      expect(st.obterStatus).not.toHaveBeenCalled();
      expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
    });
    it('caracterização (info, sem impacto): base64 com lixo DEPOIS do padding decodifica para os mesmos bytes e é aceito — não dá poder de forjar, exige o HMAC correto do corpo; um caractere ANTES do padding (bytes diferentes) é recusado', async () => {
      await semear(); const c = corpo();
      expect((await chamarWebhook(c, { 'x-docusign-signature-1': hmac(c) + 'x' })).status).toBe(200);
      const trocado = hmac(c).replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A'));
      expect((await chamarWebhook(c, { 'x-docusign-signature-1': trocado })).status).toBe(401);
    });

    it('rotação de chave: basta UMA assinatura válida entre várias (-1 inválida, -2 válida)', async () => {
      await semear(); const c = corpo();
      expect((await chamarWebhook(c, { 'x-docusign-signature-1': 'inválida', 'x-docusign-signature-2': hmac(c) })).status).toBe(200);
    });
    it('sem DOCUSIGN_CONNECT_HMAC_KEY → 503 fail-closed (mesmo com assinatura "certa" de chave vazia); chave só espaços não vale', async () => {
      const salva = process.env.DOCUSIGN_CONNECT_HMAC_KEY; const c = corpo();
      try {
        delete process.env.DOCUSIGN_CONNECT_HMAC_KEY;
        expect((await chamarWebhook(c, { 'x-docusign-signature-1': hmac(c, '') })).status).toBe(503);
      } finally { process.env.DOCUSIGN_CONNECT_HMAC_KEY = salva; }
    });
    it('assinado mas JSON inválido / sem envelopeId / envelopeId que não é GUID → 400; formato legado {envelopeId} e SIM v2.1 {data:{envelopeId}} aceitos', async () => {
      await semear();
      for (const c of ['não é json', JSON.stringify({ data: {} }), JSON.stringify({ envelopeId: 'nao-e-guid' }), JSON.stringify({ data: { envelopeId: '../../etc' } })]) expect((await chamarWebhook(c)).status).toBe(400);
      expect((await chamarWebhook(JSON.stringify({ envelopeId: ENV_ID }))).status).toBe(200);
    });
    it('corpo grande demais (> 512 KB) → 413 antes de qualquer HMAC pesado/processamento', async () => {
      const grande = JSON.stringify({ data: { envelopeId: ENV_ID }, lixo: 'x'.repeat(600 * 1024) });
      expect((await chamarWebhook(grande)).status).toBe(413);
      expect(st.obterStatus).not.toHaveBeenCalled();
    });
    it('o status do CORPO não vale: corpo diz "completed" mas a API diz "enviado" → AGUARDANDO (nada baixado nem ancorado)', async () => {
      await semear(); st.statusEnvelope = 'enviado';
      const r = await chamarWebhook(JSON.stringify({ event: 'envelope-completed', data: { envelopeId: ENV_ID, status: 'completed' } }));
      expect(JSON.parse(r.texto).data.resultado).toBe('AGUARDANDO');
      expect(st.baixar).not.toHaveBeenCalled();
    });
    it('falha de processamento → 500 SEM a mensagem (o Connect reentrega), cessão intacta e claim liberado', async () => {
      const s = await semear(); st.ancora.mockRejectedValueOnce(new Error('segredo: chave do horizon'));
      const r = await chamarWebhook(corpo());
      expect(r.status).toBe(500); expect(r.texto).not.toContain('segredo');
      expect((await linha(s.cessaoId)).docusignConclusaoIniciadaEm).toBeNull();
      expect((await chamarWebhook(corpo())).status).toBe(200); // a reentrega conclui
    });
    // F-DS3-1 (lacuna operacional): quando o PRIMEIRO chamador cai DEPOIS de assumir o claim (processo morto, sem `catch`), o webhook
    // da reentrega recebe EM_ANDAMENTO com HTTP 200 e o Connect considera entregue; só o polling manual do /admin retoma, e não há
    // varredor agendado (nenhuma rota em app/api/ops cobre cessões ENVIADA_DOCUSIGN presas).
    it('F-DS3-1 (caracterização) — claim deixado por processo morto: o webhook responde 200 EM_ANDAMENTO enquanto o claim é recente (a reentrega NÃO conclui); só depois da janela, ou pelo polling do /admin, conclui', async () => {
      const s = await semear();
      await db.cessao.update({ where: { id: s.cessaoId }, data: { docusignConclusaoIniciadaEm: new Date(Date.now() - 60_000) } }); // morreu há 1 min
      const r = await chamarWebhook(corpo());
      expect(r.status).toBe(200); expect(JSON.parse(r.texto).data.resultado).toBe('EM_ANDAMENTO');
      expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
    });
  });

  describe('DS2 — enviarCessaoParaAssinatura', () => {
    it('PENDENTE → ENVIADA_DOCUSIGN com 1 envelope, transactionId determinístico da cessão, e-mail só ao DocuSign, audit sem memo/hash/PII; repetir NÃO cria 2º envelope (jaEnviada)', async () => {
      const s = await semear({ status: 'PENDENTE' });
      const r = await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op:maria' });
      expect(r).toMatchObject({ status: 'ENVIADA_DOCUSIGN', envelopeId: ENV_ID, jaEnviada: false });
      const arg = st.criar.mock.calls[0][0] as { transactionId: string; signatario: { email: string } };
      expect(arg.transactionId).toBe(transactionIdDaCessao(s.cessaoId));
      expect(arg.signatario.email).toMatch(/@plina\.test$/);
      const ev = await db.eventoAudit.findFirstOrThrow({ where: { cessaoId: s.cessaoId, acao: 'CESSAO_ENVIADA_DOCUSIGN' } });
      expect(ev.payloadHash).toBeNull(); expect(ev.stellarTxHash).toBeNull();
      expect(JSON.stringify(ev)).not.toMatch(/Cedente de Teste|@plina\.test/);
      const r2 = await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op:maria' });
      expect(r2).toMatchObject({ envelopeId: ENV_ID, jaEnviada: true });
      expect(st.criar).toHaveBeenCalledTimes(1); expect(await audits(s.cessaoId, 'CESSAO_ENVIADA_DOCUSIGN')).toBe(1);
    });

    it('5 envios SIMULTÂNEOS (o DocuSign demora): UM criarEnvelope; as outras 4 recebem o envelope ou EnvioDocusignEmAndamento; 1 audit', async () => {
      const s = await semear({ status: 'PENDENTE' });
      st.criar.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 80)); return { envelopeId: ENV_ID }; });
      const rs = await Promise.all(Array.from({ length: 5 }, () => enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }).catch((e) => e)));
      expect(st.criar).toHaveBeenCalledTimes(1);
      for (const r of rs) expect(r instanceof EnvioDocusignEmAndamentoError || (r as { envelopeId?: string }).envelopeId === ENV_ID).toBe(true);
      expect(await audits(s.cessaoId, 'CESSAO_ENVIADA_DOCUSIGN')).toBe(1);
      expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
    });

    it('QUEDA depois de criar o envelope e ANTES de gravar no banco: a cessão fica PENDENTE com a marca; dentro da janela bloqueia; depois dela CONSULTA o transactionId e usa o envelope existente — nunca cria o 2º', async () => {
      const s = await semear({ status: 'PENDENTE' });
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('queda depois do DocuSign'));
      expect((await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' })))?.message).toMatch(/queda/);
      vi.restoreAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const c1 = await linha(s.cessaoId);
      expect(c1).toMatchObject({ status: 'PENDENTE', docusignEnvelopeId: null }); expect(c1.docusignEnvioIniciadoEm).not.toBeNull();
      expect((await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))) instanceof EnvioDocusignEmAndamentoError).toBe(true);
      st.buscar.mockResolvedValue(ENV_ID); // o envelope existe no DocuSign
      const r = await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op', agora: Date.now() + DOCUSIGN_ENVIO_JANELA_MS + 1000 });
      expect(r).toMatchObject({ envelopeId: ENV_ID, jaEnviada: false });
      expect(st.criar).toHaveBeenCalledTimes(1); // só o da 1ª tentativa
      expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
    });

    it('RESULTADO_INCERTO: se o transactionId acha o envelope grava-o sem criar outro; se NÃO acha, erro, cessão continua PENDENTE e a próxima chamada CONSULTA antes de reenviar', async () => {
      const a = await semear({ status: 'PENDENTE' });
      st.criar.mockRejectedValueOnce(new DocusignError('RESULTADO_INCERTO', 'timeout')); st.buscar.mockResolvedValueOnce(ENV_ID);
      expect((await enviarCessaoParaAssinatura({ cessaoId: a.cessaoId, operador: 'op' })).envelopeId).toBe(ENV_ID);
      expect(st.criar).toHaveBeenCalledTimes(1);
      const b = await semear({ status: 'PENDENTE' });
      st.criar.mockReset().mockRejectedValueOnce(new DocusignError('RESULTADO_INCERTO', 'timeout')); st.buscar.mockReset().mockResolvedValue(null);
      expect(await erro(enviarCessaoParaAssinatura({ cessaoId: b.cessaoId, operador: 'op' }))).not.toBeNull();
      expect((await linha(b.cessaoId)).status).toBe('PENDENTE');
      st.buscar.mockClear(); st.criar.mockResolvedValue({ envelopeId: ENV_ID });
      await enviarCessaoParaAssinatura({ cessaoId: b.cessaoId, operador: 'op' }); // a marca ficou "velha": assume já, consultando antes
      expect(st.buscar).toHaveBeenCalled();
    });

    it('erro DEFINITIVO (rejeitado) libera o claim (marca nula) e a nova tentativa reenvia na hora', async () => {
      const s = await semear({ status: 'PENDENTE' });
      st.criar.mockRejectedValueOnce(new DocusignError('REQUISICAO_REJEITADA', 'documento inválido', 400));
      expect(await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))).not.toBeNull();
      expect((await linha(s.cessaoId)).docusignEnvioIniciadoEm).toBeNull();
      expect((await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' })).envelopeId).toBe(ENV_ID);
    });

    it('pré-condições: cedente sem nome/e-mail recusa ANTES do claim e do DocuSign; cessão inexistente, CANCELADA/EXPIRADA recusam; ASSINADA devolve o envelope existente (jaEnviada)', async () => {
      const semEmail = await semear({ status: 'PENDENTE' });
      await db.leadVendedor.update({ where: { id: semEmail.leadId }, data: { email: '' } });
      expect(await erro(enviarCessaoParaAssinatura({ cessaoId: semEmail.cessaoId, operador: 'op' }))).not.toBeNull();
      expect((await linha(semEmail.cessaoId)).docusignEnvioIniciadoEm).toBeNull();
      expect(st.criar).not.toHaveBeenCalled();
      expect(await erro(enviarCessaoParaAssinatura({ cessaoId: 'nao_existe', operador: 'op' }))).not.toBeNull();
      for (const status of ['CANCELADA', 'EXPIRADA'] as const) { const s = await semear({ status }); expect(await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))).not.toBeNull(); }
      const ass = await semear({ status: 'ASSINADA' });
      expect(await enviarCessaoParaAssinatura({ cessaoId: ass.cessaoId, operador: 'op' })).toMatchObject({ jaEnviada: true, envelopeId: ENV_ID });
      expect(st.criar).not.toHaveBeenCalled();
    });

    it('o PDF recebe os fatos do serviço: demonstracao = (rede ≠ PUBLIC), hashLaudo = payloadHash do ÚLTIMO COTA_VALIDADA da cessão, valores formatados; sem PII além do nome do cedente (que só vai ao DocuSign)', async () => {
      const s = await semear({ status: 'PENDENTE' });
      const t0 = Date.now();
      await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'op', cessaoId: s.cessaoId, payloadJson: {}, payloadHash: 'a'.repeat(64), criadoEm: new Date(t0 - 5000) } as never });
      await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'op', cessaoId: s.cessaoId, payloadJson: {}, payloadHash: 'b'.repeat(64), criadoEm: new Date(t0 - 1000) } as never });
      await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' });
      expect(st.pdf.mock.calls[0][0]).toMatchObject({ demonstracao: true, hashLaudo: 'b'.repeat(64), cessaoId: s.cessaoId, administradora: 'Adm Ficticia' });
      const outra = await semear({ status: 'PENDENTE' }); st.rede = 'PUBLIC'; st.pdf.mockClear();
      await enviarCessaoParaAssinatura({ cessaoId: outra.cessaoId, operador: 'op' }).catch(() => undefined);
      if (st.pdf.mock.calls[0]) expect(st.pdf.mock.calls[0][0]).toMatchObject({ demonstracao: false });
    });

    // F-DS2-1 (FECHADO em 28c8371): em PUBLIC o envio sem laudo registrado é recusado ANTES do claim e do DocuSign; em testnet segue.
    describe('F-DS2-1 — laudo para enviar na mainnet', () => {
      const laudo = (cessaoId: string, hash = 'a'.repeat(64), criadoEm?: Date) => db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'op', cessaoId, payloadJson: {}, payloadHash: hash, ...(criadoEm ? { criadoEm } : {}) } as never });
      it('PUBLIC sem laudo → EnvioDocusignLaudoAusenteError (LAUDO_AUSENTE): nenhum claim (marca nula), nenhum envelope, nenhum PDF, nenhum audit; a cessão continua PENDENTE', async () => {
        st.rede = 'PUBLIC';
        const s = await semear({ status: 'PENDENTE' });
        const e = await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }));
        expect(e).toBeInstanceOf(EnvioDocusignLaudoAusenteError); expect((e as { code?: string }).code).toBe('LAUDO_AUSENTE');
        expect(await linha(s.cessaoId)).toMatchObject({ status: 'PENDENTE', docusignEnvioIniciadoEm: null, docusignEnvelopeId: null });
        expect(st.criar).not.toHaveBeenCalled(); expect(st.pdf).not.toHaveBeenCalled(); expect(await audits(s.cessaoId)).toBe(0);
      });
      it('PUBLIC COM laudo → envia, e o PDF recebe demonstracao:false e o hashLaudo do ÚLTIMO laudo; laudo de OUTRA cessão não vale', async () => {
        st.rede = 'PUBLIC';
        const outra = await semear({ status: 'PENDENTE' }); await laudo(outra.cessaoId, 'c'.repeat(64));
        const s = await semear({ status: 'PENDENTE' });
        expect(await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))).toBeInstanceOf(EnvioDocusignLaudoAusenteError);
        const t0 = Date.now(); await laudo(s.cessaoId, 'a'.repeat(64), new Date(t0 - 4000)); await laudo(s.cessaoId, 'b'.repeat(64), new Date(t0 - 1000));
        await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' });
        expect(st.pdf.mock.calls[0][0]).toMatchObject({ demonstracao: false, hashLaudo: 'b'.repeat(64) });
        expect((await linha(s.cessaoId)).status).toBe('ENVIADA_DOCUSIGN');
      });
      it('PUBLIC com laudo de payloadHash nulo → também recusa (laudo sem hash não é laudo)', async () => {
        st.rede = 'PUBLIC';
        const s = await semear({ status: 'PENDENTE' });
        await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'op', cessaoId: s.cessaoId, payloadJson: {}, payloadHash: null } as never });
        expect(await erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))).toBeInstanceOf(EnvioDocusignLaudoAusenteError);
      });
      it('testnet sem laudo → segue (PDF de demonstração com hashLaudo nulo); a idempotência continua: cessão já ENVIADA devolve o envelope SEM exigir o laudo, mesmo em PUBLIC', async () => {
        const s = await semear({ status: 'PENDENTE' });
        await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' });
        expect(st.pdf.mock.calls[0][0]).toMatchObject({ hashLaudo: null, demonstracao: true });
        st.rede = 'PUBLIC';
        expect(await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' })).toMatchObject({ jaEnviada: true, envelopeId: ENV_ID });
        expect(st.criar).toHaveBeenCalledTimes(1);
      });
      it('a ordem das recusas em PUBLIC: cedente sem e-mail e cessão inexistente continuam recusando; a falta de laudo é checada ANTES do claim mesmo com 5 envios simultâneos (0 claims, 0 envelopes)', async () => {
        st.rede = 'PUBLIC';
        const s = await semear({ status: 'PENDENTE' });
        const rs = await Promise.all(Array.from({ length: 5 }, () => erro(enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' }))));
        expect(rs.every((e) => e instanceof EnvioDocusignLaudoAusenteError)).toBe(true);
        expect(st.criar).not.toHaveBeenCalled();
        expect((await linha(s.cessaoId)).docusignEnvioIniciadoEm).toBeNull();
      });
    });

    it('F-DS2-1 (caracterização) — hoje, SEM laudo, o envio segue e o PDF é gerado com hashLaudo = null (em testnet isso é só demonstração)', async () => {
      const s = await semear({ status: 'PENDENTE' });
      await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' });
      expect(st.pdf.mock.calls[0][0]).toMatchObject({ hashLaudo: null, demonstracao: true });
      expect(st.criar).toHaveBeenCalledTimes(1);
    });

    it('ciclo completo: PENDENTE → enviar → ENVIADA_DOCUSIGN → webhook concluído → ASSINADA com hash e âncora, cada passo uma vez', async () => {
      const s = await semear({ status: 'PENDENTE' });
      await enviarCessaoParaAssinatura({ cessaoId: s.cessaoId, operador: 'op' });
      const w = await chamarWebhook(JSON.stringify({ data: { envelopeId: ENV_ID } }));
      expect(JSON.parse(w.texto).data.resultado).toBe('ASSINADA');
      expect(await linha(s.cessaoId)).toMatchObject({ status: 'ASSINADA', hashDocumento: sha(PDF) });
      expect(await audits(s.cessaoId, 'CESSAO_ENVIADA_DOCUSIGN')).toBe(1); expect(await audits(s.cessaoId, 'CESSAO_ASSINADA')).toBe(1);
    });
  });
});
