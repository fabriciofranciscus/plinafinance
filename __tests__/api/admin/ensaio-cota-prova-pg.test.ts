/**
 * ENSAIO da cota de prova (QA Vera) — a cota inteira, na ordem da tela do /admin (feat/admin-pipeline-cota-prova), com o corpo
 * EXATO que cada botão envia, passando pela rota real `/api/admin/originacao` → serviços reais (cessão, laudo, DocuSign/DS3,
 * titular, anuência, Pix SIMULADO do E1-2, incorporação com o registro ancorado do E1-P) → Postgres REAL; no fim, o verificador
 * `evidencia:cota` confere os 5 passos. Cedente FICTÍCIO (CPF sintético válido, e-mail .test). Mocks só de FORA: sessão/CSRF admin,
 * DocuSign (envelope/status/PDF), Blob (memória), âncora e issuer Stellar (testnet simulada, coerente), e-mail.
 * Opt-in: TEST_PG_URL local descartável.
 */
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
  }
  process.env.TITULAR_HMAC_SECRET = 'segredo-hmac-do-titular-de-teste-com-mais-de-32-chars';
  process.env.PIX_MAX_BRL = '50000';
  process.env.DOCUSIGN_CONNECT_HMAC_KEY = 'chave-connect-de-teste-com-bastante-entropia';
  return url;
});

const ISSUER_PK = Keypair.random().publicKey();
const ENV_ID = '11111111-2222-3333-4444-555555555555';
const st = vi.hoisted(() => ({
  admin: true, csrf: null as null | Response, rede: 'TESTNET',
  // DocuSign / Blob
  statusEnvelope: 'enviado' as string, criar: vi.fn(), buscar: vi.fn(), obterStatus: vi.fn(), baixar: vi.fn(), pdf: vi.fn(), blob: new Map<string, Buffer>(), blobPsp: vi.fn(), email: vi.fn(), alerta: vi.fn(),
  // Stellar simulada (coerente)
  ancoraMapa: new Map<string, string>(), ancoraOrdem: new Map<string, number>(), ordem: 0, ancoraFalha: null as Error | null,
  built: [] as Array<{ hash: string; xdr: string; amount: string }>, chain: new Map<string, { successful: boolean }>(), calls: [] as string[], fetchSupplyDasClasses: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: async () => st.admin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: () => st.csrf }));
vi.mock('@/lib/integrations/docusign', async (orig) => {
  const m = await orig<typeof import('@/lib/integrations/docusign')>();
  return { ...m, criarEnvelope: st.criar, buscarEnvelopePorTransactionId: st.buscar, obterStatusEnvelope: st.obterStatus, baixarDocumentoAssinado: st.baixar };
});
vi.mock('@/lib/comprovante/cessao-store', () => ({
  lerCessaoAssinada: async (id: string) => st.blob.get(id) ?? null,
  guardarCessaoAssinada: async (id: string, b: Buffer) => { if (st.blob.has(id)) throw new Error('já existe'); st.blob.set(id, Buffer.from(b)); return `cessoes/${id}/assinada.pdf`; },
}));
vi.mock('@/lib/comprovante/cessao-pdf', async (orig) => ({ ...(await orig<typeof import('@/lib/comprovante/cessao-pdf')>()), buildCessaoPdf: st.pdf }));
vi.mock('@/lib/integrations/blob/comprovante-psp', async (orig) => ({ ...(await orig<typeof import('@/lib/integrations/blob/comprovante-psp')>()), guardarComprovantePsp: st.blobPsp }));
vi.mock('@/lib/email/notify-cedente', () => ({ notifyCedente: st.email }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: st.alerta }));
vi.mock('@/lib/stellar/ancora', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/ancora')>()),
  ancorarSha256: async ({ sha256Hex }: { sha256Hex: string }) => {
    st.calls.push('ancora');
    if (st.ancoraFalha) throw st.ancoraFalha;
    const ja = st.ancoraMapa.get(sha256Hex);
    const txHash = ja ?? `ancora${(st.ancoraMapa.size + 1).toString(16).padStart(58, '0')}`;
    if (!ja) { st.ancoraMapa.set(sha256Hex, txHash); st.ancoraOrdem.set(txHash, ++st.ordem); }
    return { txHash, reutilizada: !!ja, ledgerCloseTime: '2026-11-13T12:00:00Z' };
  },
}));
vi.mock('@/lib/stellar/audit', async (orig) => {
  const m = await orig<typeof import('@/lib/stellar/audit')>();
  return { ...m, registerOnChainHash: async (p: unknown) => ({ payloadHash: m.sha256OfPayload(p as never), txHash: 'e'.repeat(64) }) };
});
vi.mock('@/lib/stellar/config', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/config')>()), get STELLAR_NETWORK() { return st.rede; } }));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({ publicKey: () => ISSUER_PK }) }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.fetchSupplyDasClasses }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  buildIssueAssetTx: vi.fn(async (_s: unknown, _d: string, amount: string) => {
    st.calls.push('build');
    const n = st.built.length + 1;
    const t = { hash: `emissao${n}`, xdr: `XDR${n}`, amount };
    st.built.push(t);
    return { ...t, maxTime: Math.floor(Date.now() / 1000) + 120, sequence: `seq${n}` };
  }),
  quemConsumiuSequence: vi.fn(async () => ({ status: 'INDETERMINADO', motivo: 'n/a' })),
  submitEnvelope: vi.fn(async (xdr: string) => {
    st.calls.push('submit');
    const t = st.built.find((b) => b.xdr === xdr)!;
    st.chain.set(t.hash, { successful: true });
    st.ancoraOrdem.set(t.hash, ++st.ordem);
    return { status: 'SUCCESS', hash: t.hash };
  }),
  buscarTxPorHash: vi.fn(async (hash: string) => (st.chain.get(hash) ? { found: true, successful: true, ledgerCloseTime: 'x' } : { found: false })),
  buscarEmissaoPorMemo: vi.fn(async () => null),
  txExpirouNaRede: vi.fn(async () => ({ status: 'EM_ABERTO', hash: 'x', maxTime: 0 })),
}));

import { db } from '@/lib/db';
import { POST } from '@/app/api/admin/originacao/route';
import { resetNavSupplyCache } from '@/lib/services/nav-supply';
import { bytesCanonicos } from '@/lib/services/json-canonico';
import { assetCode } from '@/lib/stellar/config';
import { sha256OfPayload } from '@/lib/stellar/audit';
import { memoDaIncorporacao, montarEvidencia, type Fontes, type TxLida } from '../../../scripts/evidencia-cota/core';
import { Prisma } from '@prisma/client';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PDF_ASSINADO = Buffer.from('%PDF-assinado-pelo-cedente-fficticio');
const LAUDO_SHA = createHash('sha256').update('laudo-fictício-da-cota-de-prova').digest('hex');
const LAUDO_URL = `https://laudo.exemplo.test/cota-de-prova.pdf#sha256=${LAUDO_SHA}`;
const LIMPAR = 'TRUNCATE "TentativaEmissao","MovimentoFundo","TransferenciaPix","Pagamento","EventoAudit","Cota","Cessao","Oferta","LeadVendedor","Pessoa" RESTART IDENTITY CASCADE';

/** CPF sintético com dígitos válidos (nunca é de uma pessoa real; nunca é impresso). */
function cpfSintetico() {
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const dv = (d: number[]) => { const r = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join('');
}
const CPF = cpfSintetico();

/** O que o botão da tela envia (vendedor-pipeline.tsx): POST com { action, ...payload } e o header x-plina-admin. */
const tela = async (action: string, payload: Record<string, unknown>) => {
  const r = await POST(new Request('http://x/api/admin/originacao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-plina-admin': '1' }, body: JSON.stringify({ action, ...payload }) }));
  const texto = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(texto); } catch { return {}; } })() as Record<string, any>, texto };
};

async function semearOferta() {
  const pessoa = await db.pessoa.create({ data: { privyId: 'did:privy:ensaio', email: 'pessoa.ensaio@exemplo.test', nome: 'Cedente Ficticio', publicKey: 'GENSAIO'.padEnd(56, 'A'), cpfNormalizado: CPF, kycAprovado: true, isSyntheticCpf: false } as never });
  const lead = await db.leadVendedor.create({ data: { nome: 'Cedente Ficticio', email: 'cedente.ensaio@exemplo.test', pessoaId: pessoa.id, status: 'OFERTA_ACEITA' as never } });
  const oferta = await db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '50000.00', administradora: 'Administradora Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '40000.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
  return { leadId: lead.id, ofertaId: oferta.id, pessoaId: pessoa.id };
}

/** Horizon FALSO coerente com o que o ensaio fez (âncoras com memo = sha256 dos bytes; emissão com payment do issuer). */
function fontes(cessaoMemos: Map<string, string>): Fontes {
  return {
    hashPayload: (p) => sha256OfPayload(p as never),
    ativo: () => ({ code: assetCode, issuer: ISSUER_PK }),
    async registroIncorporacao(cotaId) {
      const ev = await db.eventoAudit.findFirst({ where: { cotaId, acao: 'COTA_INCORPORADA' }, select: { payloadJson: true, payloadHash: true } });
      const p = ev?.payloadJson as { registroCanonico?: unknown; ancoraTxHash?: string } | null | undefined;
      if (!p?.registroCanonico) return null;
      return { bytes: bytesCanonicos(p.registroCanonico), hashRegistrado: ev?.payloadHash ?? null, txHash: p.ancoraTxHash ?? null };
    },
    async cota(id) { const c = await db.cota.findUnique({ where: { id } }); return c && { id: c.id, cessaoId: c.cessaoId, hashValidacao: c.hashValidacao, validacaoTxHash: c.validacaoTxHash, emissaoTxHash: c.emissaoTxHash, tokensEmitidos: c.tokensEmitidos.toString() }; },
    laudo: (h) => db.eventoAudit.findFirst({ where: { acao: 'COTA_VALIDADA', payloadHash: h }, select: { payloadJson: true, payloadHash: true } }),
    cessao: (id) => db.cessao.findUnique({ where: { id }, select: { status: true, hashDocumento: true, onChainTxHash: true } }),
    pdfCessao: async (id) => st.blob.get(id) ?? null,
    async pagamento(id) { const t = await db.transferenciaPix.findUnique({ where: { cessaoId: id }, select: { status: true, ancoraTxHash: true, comprovanteSha256: true, e2eId: true } }); return t && { status: t.status, onChainTxHash: t.ancoraTxHash, hashComprovante: t.comprovanteSha256, e2eId: t.e2eId }; },
    async comprovante(id) { const t = await db.transferenciaPix.findUnique({ where: { cessaoId: id }, select: { comprovante: true } }); return t?.comprovante ? Buffer.from(t.comprovante, 'utf8') : null; },
    async aporte(id) { const m = await db.movimentoFundo.findFirst({ where: { cotaId: id, tipo: 'APORTE_COTA' } }); return m && { txHash: m.txHash, hashValidacao: m.hashValidacao, valorBrl: m.valorBrl.toString(), navPorToken: m.navPorToken?.toString() ?? null }; },
    async tx(hash): Promise<TxLida | null> {
      const memoAncora = [...st.ancoraMapa.entries()].find(([, tx]) => tx === hash)?.[0];
      if (memoAncora) return { sucesso: true, memoHex: memoAncora, ordem: String(st.ancoraOrdem.get(hash) ?? 0) };
      const b = st.built.find((x) => x.hash === hash);
      if (b && st.chain.get(hash)?.successful) {
        const cota = await db.cota.findFirst({ where: { emissaoTxHash: hash } });
        const chave = cota?.cessaoId ?? cota?.hashValidacao ?? '';
        return { sucesso: true, memoHex: memoDaIncorporacao(chave), ordem: String(st.ancoraOrdem.get(hash) ?? 0), pagamentos: [{ asset: `${assetCode}:${ISSUER_PK}`, amount: b.amount, from: ISSUER_PK, to: 'GPOS' }] };
      }
      if (hash === 'e'.repeat(64)) { const l = await db.eventoAudit.findFirst({ where: { acao: 'COTA_VALIDADA' }, orderBy: { criadoEm: 'desc' } }); return { sucesso: true, memoHex: l?.payloadHash ?? null, ordem: '1' }; } // tx do laudo (registerOnChainHash simulado)
      void cessaoMemos;
      return null;
    },
  };
}

describe.skipIf(!PG)('ENSAIO — cota de prova inteira pela tela do /admin (bodies da UI → rota real → serviços reais → Postgres)', () => {
  beforeAll(() => {
    process.env.STELLAR_ISSUER_SECRET = 'S-ensaio';
    process.env.STELLAR_PLINA_POSITION_PUBLIC = Keypair.random().publicKey();
    delete process.env.STELLAR_NETWORK; delete process.env.PSP_PROVIDER;
  });
  afterAll(async () => { await db.$disconnect(); });
  afterEach(async () => { await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS vera_quebra_incorp ON "EventoAudit"'); vi.restoreAllMocks(); });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    st.admin = true; st.csrf = null; st.rede = 'TESTNET'; st.statusEnvelope = 'enviado';
    st.blob = new Map(); st.ancoraMapa = new Map(); st.ancoraOrdem = new Map(); st.ordem = 0; st.ancoraFalha = null; st.built = []; st.chain = new Map(); st.calls = [];
    st.criar.mockReset().mockResolvedValue({ envelopeId: ENV_ID }); st.buscar.mockReset().mockResolvedValue(null);
    st.obterStatus.mockReset().mockImplementation(async () => st.statusEnvelope); st.baixar.mockReset().mockResolvedValue(PDF_ASSINADO);
    st.pdf.mockReset().mockResolvedValue(Buffer.from('%PDF-demo')); st.blobPsp.mockReset().mockImplementation(async ({ cessaoId }: { cessaoId: string }) => ({ pathname: `comprovantes-psp/${cessaoId}.json` }));
    st.email.mockReset().mockResolvedValue(undefined); st.alerta.mockReset().mockResolvedValue(true);
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: { circulante: new Prisma.Decimal('0'), tesouraria: new Prisma.Decimal('0') }, subordinada: { circulante: new Prisma.Decimal('0'), tesouraria: new Prisma.Decimal('0') } });
    resetNavSupplyCache();
    await db.$executeRawUnsafe(LIMPAR);
  });

  /** Percorre a tela até o ponto pedido; devolve ids e hashes. */
  async function percorrer(ate: 'incorporar' | 'pix' | 'anuencia' | 'titular' | 'assinatura' | 'envio' | 'laudo' | 'cessao') {
    const s = await semearOferta();
    const c = await tela('registrar-cessao', { ofertaId: s.ofertaId }); expect(c.status, c.texto).toBe(200);
    const cessaoId = c.json.cessaoId as string;
    if (ate === 'cessao') return { ...s, cessaoId };
    const l = await tela('registrar-laudo', { cessaoId, laudoUrl: LAUDO_URL }); expect(l.status, l.texto).toBe(200);
    const hashLaudo = l.json.hashValidacao as string;
    if (ate === 'laudo') return { ...s, cessaoId, hashLaudo };
    const e = await tela('enviar-cessao', { cessaoId }); expect(e.status, e.texto).toBe(200);
    if (ate === 'envio') return { ...s, cessaoId, hashLaudo };
    st.statusEnvelope = 'concluido';
    const sy = await tela('sincronizar-cessoes', { cessaoId }); expect(sy.status, sy.texto).toBe(200);
    if (ate === 'assinatura') return { ...s, cessaoId, hashLaudo };
    const t = await tela('confirmar-titular-laudo', { cessaoId, situacao: 'TITULAR_UNICO', atestado: true }); expect(t.status, t.texto).toBe(200);
    if (ate === 'titular') return { ...s, cessaoId, hashLaudo };
    const a = await tela('registrar-anuencia', { hashValidacao: hashLaudo, status: 'DECLARADA_PENDENTE' }); expect(a.status, a.texto).toBe(200);
    if (ate === 'anuencia') return { ...s, cessaoId, hashLaudo };
    const p = await tela('pagar-cedente', { cessaoId }); expect(p.status, p.texto).toBe(200); expect(p.json.status).toBe('COMPROVADA');
    if (ate === 'pix') return { ...s, cessaoId, hashLaudo };
    const i = await tela('incorporar-cota', { cessaoId }); expect(i.status, i.texto).toBe(200);
    return { ...s, cessaoId, hashLaudo, cotaId: i.json.cotaId as string, txEmissao: i.json.txHash as string };
  }

  it('CAMINHO FELIZ: a cota de prova inteira na ordem da tela; no fim o evidencia:cota confere os 5 passos (CADEIA_COMPLETA) e nada vaza PII', async () => {
    const r = await percorrer('incorporar');
    // estado final do banco
    expect((await db.cessao.findUniqueOrThrow({ where: { id: r.cessaoId } })).status).toBe('ASSINADA');
    expect((await db.transferenciaPix.findUniqueOrThrow({ where: { cessaoId: r.cessaoId } })).status).toBe('COMPROVADA');
    expect((await db.pagamento.findUniqueOrThrow({ where: { cessaoId: r.cessaoId } })).status).toBe('EXECUTADO');
    const cota = await db.cota.findUniqueOrThrow({ where: { id: r.cotaId } });
    expect(cota).toMatchObject({ cessaoId: r.cessaoId, hashValidacao: r.hashLaudo });
    expect((await db.leadVendedor.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('COTA_INCORPORADA');
    expect(await db.cota.count()).toBe(1);
    expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(1);
    expect(st.built).toHaveLength(1); // UMA emissão
    // PDF da cessão citou o hash do laudo (enviar-cessao só depois do laudo)
    expect(st.pdf.mock.calls[0][0]).toMatchObject({ hashLaudo: r.hashLaudo });
    // o verificador, com o Horizon coerente
    const e = await montarEvidencia(r.cotaId, fontes(new Map()));
    expect(e.passos.map((p) => `${p.passo}:${p.confere ? 'ok' : p.motivo}`)).toEqual(['VALIDACAO:ok', 'CESSAO:ok', 'LIQUIDACAO:ok', 'INCORPORACAO:ok', 'EMISSAO:ok']);
    expect(e.classificacao).toBe('CADEIA_COMPLETA');
    // sem PII em nenhuma resposta da tela nem no relatório
    const saida = JSON.stringify(e);
    for (const v of [CPF, 'Cedente Ficticio', 'cedente.ensaio@exemplo.test', 'pessoa.ensaio@exemplo.test']) expect(saida).not.toContain(v);
  });

  it('IDEMPOTÊNCIA (duplo clique / reload em cada botão): repetir cada passo da tela não duplica envelope, pagamento, âncora nem emissão', async () => {
    const r = await percorrer('incorporar');
    const antes = { env: st.criar.mock.calls.length, built: st.built.length, ancoras: st.ancoraMapa.size, pag: await db.pagamento.count(), pix: await db.transferenciaPix.count(), ev: await db.eventoAudit.count() };
    expect((await tela('registrar-cessao', { ofertaId: (await db.oferta.findFirstOrThrow()).id })).status).toBe(200);
    expect((await tela('enviar-cessao', { cessaoId: r.cessaoId })).status).toBeLessThan(500);
    expect((await tela('sincronizar-cessoes', { cessaoId: r.cessaoId })).status).toBe(200);
    expect((await tela('pagar-cedente', { cessaoId: r.cessaoId })).status).toBeGreaterThanOrEqual(200);
    const de_novo = await tela('incorporar-cota', { cessaoId: r.cessaoId });
    expect(de_novo.status).toBe(409); expect(de_novo.json.code).toBe('COTA_JA_INCORPORADA');
    expect({ env: st.criar.mock.calls.length, built: st.built.length, ancoras: st.ancoraMapa.size, pag: await db.pagamento.count(), pix: await db.transferenciaPix.count(), ev: await db.eventoAudit.count({ where: { acao: { in: ['COTA_INCORPORADA', 'PIX_SIMULADO_EXECUTADO'] } } }) }).toMatchObject({ env: antes.env, built: antes.built, ancoras: antes.ancoras, pag: antes.pag, pix: antes.pix });
  });

  it('ORDEM E TRAVAS: cada botão fora de hora recusa com código e sem efeito (enviar sem laudo, pagar sem atestado, incorporar sem Pix)', async () => {
    const s = await semearOferta();
    const c = await tela('registrar-cessao', { ofertaId: s.ofertaId }); const cessaoId = c.json.cessaoId;
    expect(st.criar).not.toHaveBeenCalled();                                     // registrar NÃO envia
    const e1 = await tela('enviar-cessao', { cessaoId }); expect(e1.status).toBe(409); expect(e1.json.code).toBe('LAUDO_AUSENTE');
    const l = await tela('registrar-laudo', { cessaoId, laudoUrl: LAUDO_URL }); expect(l.status).toBe(200);
    // atestado antes de a cessão estar assinada / pagar antes do atestado
    const p0 = await tela('pagar-cedente', { cessaoId }); expect(p0.status).toBeGreaterThanOrEqual(400);
    expect(await db.pagamento.count()).toBe(0);
    await tela('enviar-cessao', { cessaoId }); st.statusEnvelope = 'concluido'; await tela('sincronizar-cessoes', { cessaoId });
    const p1 = await tela('pagar-cedente', { cessaoId }); expect(p1.status).toBe(409);                  // sem atestado do titular
    expect(await db.pagamento.count()).toBe(0);
    const i1 = await tela('incorporar-cota', { cessaoId }); expect(i1.status).toBe(409);               // sem Pix
    expect(['PAGAMENTO_NAO_EXECUTADO', 'PIX_NAO_COMPROVADO']).toContain(i1.json.code);
    expect(st.built).toHaveLength(0);
    // atestado sem KYC / com situação que não paga automático não passa a pagar
    const t = await tela('confirmar-titular-laudo', { cessaoId, situacao: 'ESPOLIO', atestado: true });
    expect(t.status).toBe(200);
    const p2 = await tela('pagar-cedente', { cessaoId }); expect(p2.status).toBeGreaterThanOrEqual(400);
    expect(await db.pagamento.count()).toBe(0);
  });

  it('assinatura ainda NÃO concluída: sincronizar não assina a cessão e o pipeline fica no passo "aguardando" (sem atestado/pagamento possíveis)', async () => {
    const r = await percorrer('envio');
    st.statusEnvelope = 'enviado';
    expect((await tela('sincronizar-cessoes', { cessaoId: r.cessaoId })).status).toBe(200);
    expect((await db.cessao.findUniqueOrThrow({ where: { id: r.cessaoId } })).status).toBe('ENVIADA_DOCUSIGN');
    expect((await tela('pagar-cedente', { cessaoId: r.cessaoId })).status).toBeGreaterThanOrEqual(400);
    expect(await db.pagamento.count()).toBe(0);
  });

  it('QUEDA NA INCORPORAÇÃO (a emissão saiu, a gravação do banco caiu): o botão "incorporar" repetido (runbook) recupera sem 2ª emissão; o verificador confere', async () => {
    const r = await percorrer('pix');
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION vera_quebra_incorp() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'vera: queda simulada'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER vera_quebra_incorp BEFORE INSERT ON "EventoAudit" FOR EACH ROW WHEN (NEW.acao = 'COTA_INCORPORADA') EXECUTE FUNCTION vera_quebra_incorp()`);
    const falhou = await tela('incorporar-cota', { cessaoId: r.cessaoId });
    expect(falhou.status).toBe(500);
    await db.$executeRawUnsafe('DROP TRIGGER vera_quebra_incorp ON "EventoAudit"');
    expect(st.built).toHaveLength(1);                         // já saiu na rede
    expect(await db.cota.count()).toBe(0);
    const ok = await tela('incorporar-cota', { cessaoId: r.cessaoId });
    expect(ok.status, ok.texto).toBe(200);
    expect(st.built).toHaveLength(1);                         // nenhuma 2ª emissão
    expect(st.ancoraMapa.size).toBe(3);                       // laudo? não: cessão PDF + comprovante Pix + registro (1 âncora de cada)
    const e = await montarEvidencia(ok.json.cotaId, fontes(new Map()));
    expect(e.passos.find((p) => p.passo === 'INCORPORACAO')!.confere).toBe(true);
    expect(e.classificacao).toBe('CADEIA_COMPLETA');
  });

  it('QUEDA DEPOIS DA COTA (a Cota gravou, o vínculo ao lead não): repetir o botão completa o vínculo sem emitir e a próxima chamada responde COTA_JA_INCORPORADA', async () => {
    const r = await percorrer('incorporar');
    await db.$executeRawUnsafe(`UPDATE "LeadVendedor" SET status = 'OFERTA_ACEITA' WHERE id = '${r.leadId}'`); // simula a queda antes do vínculo
    const built = st.built.length;
    const ok = await tela('incorporar-cota', { cessaoId: r.cessaoId });
    expect(ok.status, ok.texto).toBe(200);
    expect(st.built).toHaveLength(built);
    expect((await db.leadVendedor.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('COTA_INCORPORADA');
    expect((await tela('incorporar-cota', { cessaoId: r.cessaoId })).json.code).toBe('COTA_JA_INCORPORADA');
  });

  it('Pix com FALHA do PSP não chega a incorporar: reabrir só em FALHOU (a tela só oferece "Reabrir" nesse estado); com Pix FALHOU o incorporar recusa PIX_NAO_COMPROVADO', async () => {
    const r = await percorrer('anuencia');
    const reab = await tela('reabrir-pagamento-cedente', { cessaoId: r.cessaoId });
    expect(reab.status).toBeGreaterThanOrEqual(400);                // sem transferência FALHOU, não reabre
    await db.transferenciaPix.create({ data: { cessaoId: r.cessaoId, idempotencyKey: `pix-cedente:${r.cessaoId}`, provedor: 'SIMULADO', status: 'FALHOU', valor: '40000.00', destinoMascarado: 'CPF ***4725', motivoFalha: 'PSP_RECUSOU' } });
    const i = await tela('incorporar-cota', { cessaoId: r.cessaoId });
    expect(i.status).toBe(409);
    expect(['PIX_NAO_COMPROVADO', 'PAGAMENTO_NAO_EXECUTADO']).toContain(i.json.code);
    expect(st.built).toHaveLength(0);
  });

  it('SEGURANÇA da tela: sem sessão admin 401 e sem o header/CSRF recusa, em TODOS os botões; nada é gravado', async () => {
    const s = await semearOferta();
    const acoes: Array<[string, Record<string, unknown>]> = [
      ['registrar-cessao', { ofertaId: s.ofertaId }], ['registrar-laudo', { cessaoId: 'x', laudoUrl: LAUDO_URL }], ['enviar-cessao', { cessaoId: 'x' }],
      ['sincronizar-cessoes', { cessaoId: 'x' }], ['confirmar-titular-laudo', { cessaoId: 'x', situacao: 'TITULAR_UNICO', atestado: true }],
      ['registrar-anuencia', { hashValidacao: LAUDO_SHA, status: 'DECLARADA_PENDENTE' }], ['pagar-cedente', { cessaoId: 'x' }], ['reabrir-pagamento-cedente', { cessaoId: 'x' }], ['incorporar-cota', { cessaoId: 'x' }],
    ];
    st.admin = false;
    for (const [a, p] of acoes) expect((await tela(a, p)).status, a).toBe(401);
    st.admin = true; st.csrf = new Response(null, { status: 403 });
    for (const [a, p] of acoes) expect((await tela(a, p)).status, a).toBe(403);
    expect(await db.cessao.count()).toBe(0);
    expect(st.criar).not.toHaveBeenCalled();
  });

  it('o executar-pix-simulado da tela antiga NÃO existe mais: 400 e nenhum pagamento (a tela nova não o chama)', async () => {
    const r = await percorrer('titular');
    const x = await tela('executar-pix-simulado', { cessaoId: r.cessaoId });
    expect(x.status).toBe(400);
    expect(await db.pagamento.count()).toBe(0);
  });

  it('a tela e o ensaio falam as MESMAS ações: toda action chamada em app/admin/vendedor-pipeline.tsx está coberta aqui (se a tela ganhar ou trocar um botão, este teste quebra e o ensaio precisa acompanhar)', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync(new URL('../../../app/admin/vendedor-pipeline.tsx', import.meta.url), 'utf8');
    const naTela = [...new Set([...fonte.matchAll(/call\('([a-z-]+)'/g)].map((m) => m[1]))].sort();
    const noEnsaio = ['registrar-cessao', 'registrar-laudo', 'enviar-cessao', 'sincronizar-cessoes', 'confirmar-titular-laudo', 'registrar-anuencia', 'pagar-cedente', 'reabrir-pagamento-cedente', 'incorporar-cota'].sort();
    expect(naTela).toEqual(noEnsaio);
    expect(naTela).not.toContain('executar-pix-simulado');
  });
});

