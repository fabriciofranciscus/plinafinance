/**
 * QA Vera — E1-P (contrato produtor↔verificador): o REGISTRO que `incorporarCota` realmente grava (Postgres real) é
 * lido pelo MESMO mapeamento de `scripts/evidencia-cota.ts` (copiado: o script roda main() ao ser importado) e
 * conferido por `montarEvidencia`, com um Horizon FALSO coerente com as âncoras/emissões que o produtor fez.
 * Prova o elo que os testes isolados de cada lado não provam. (Mesmo harness do teste do produtor.)
 *
 * Antes: registro canônico da incorporação ancorado ANTES da emissão, com o Postgres REAL e o registro REAL
 * (só Stellar/âncora simulados). Prova a composição que o teste do dev (que mocka o registro) não cobre:
 * bytes canônicos → SHA-256 → Memo da âncora → EventoAudit.payloadHash/payloadJson, ordem âncora→build→submit,
 * recuperação com os MESMOS números, falha da âncora sem emitir, nada de PII no registro.
 * Só roda com TEST_PG_URL local (Postgres descartável com as migrations).
 */
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
  }
  return url;
});

const ISSUER_PK = Keypair.random().publicKey();
const st = vi.hoisted(() => ({
  calls: [] as string[],
  chain: new Map<string, { successful: boolean }>(),
  built: [] as Array<{ hash: string; xdr: string; amount: string }>,
  submitScript: [] as Array<'SUCCESS' | 'AMBIGUOUS' | 'FAILED'>,
  ancoras: [] as Array<{ sha256Hex: string; contexto: string; desde: Date; reutilizada: boolean; txHash: string }>,
  ancoraMapa: new Map<string, string>(),
  ancoraFalha: null as Error | null,
  porMemo: null as null | { txHash: string; amount: string },
  fetchSupplyDasClasses: vi.fn(),
}));

vi.mock('@/lib/stellar/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/config')>();
  const mod = { ...actual } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => 'TESTNET', enumerable: true });
  return mod;
});
vi.mock('@/lib/stellar/issuer', () => ({
  executeClawback: vi.fn(),
  buildIssueAssetTx: vi.fn(async (_s: unknown, _d: string, amount: string) => {
    st.calls.push('build');
    const n = st.built.length + 1;
    const t = { hash: `hash${n}`, xdr: `XDR${n}`, amount };
    st.built.push(t);
    return { ...t, maxTime: Math.floor(Date.now() / 1000) + 120, sequence: `seq${n}` };
  }),
  quemConsumiuSequence: vi.fn(async () => ({ status: 'INDETERMINADO', motivo: 'não usado aqui' })),
  submitEnvelope: vi.fn(async (xdr: string) => {
    st.calls.push('submit');
    const t = st.built.find((b) => b.xdr === xdr)!;
    const out = st.submitScript.shift() ?? 'SUCCESS';
    if (out === 'SUCCESS') {
      st.chain.set(t.hash, { successful: true });
      return { status: 'SUCCESS', hash: t.hash };
    }
    if (out === 'FAILED') return { status: 'FAILED', hash: t.hash, resultCodes: { transaction: 'tx_failed' } };
    return { status: 'AMBIGUOUS', hash: t.hash, reason: 'timeout' };
  }),
  buscarTxPorHash: vi.fn(async (hash: string) => {
    const t = st.chain.get(hash);
    return t ? { found: true, successful: t.successful, ledgerCloseTime: 'x' } : { found: false };
  }),
  buscarEmissaoPorMemo: vi.fn(async () => st.porMemo),
  txExpirouNaRede: vi.fn(async (xdr: string) => {
    const t = st.built.find((b) => b.xdr === xdr)!;
    return { status: 'EM_ABERTO', hash: t.hash, maxTime: 0 };
  }),
}));
vi.mock('@/lib/stellar/ancora', () => ({
  ancorarSha256: vi.fn(async (i: { sha256Hex: string; contexto: string; desde: Date }) => {
    st.calls.push('ancora');
    if (st.ancoraFalha) throw st.ancoraFalha;
    const ja = st.ancoraMapa.get(i.sha256Hex);
    const txHash = ja ?? `ancoratx${st.ancoraMapa.size + 1}`;
    st.ancoraMapa.set(i.sha256Hex, txHash);
    st.ancoras.push({ ...i, reutilizada: !!ja, txHash });
    return { txHash, reutilizada: !!ja, ledgerCloseTime: 'T' };
  }),
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({ publicKey: () => ISSUER_PK }) }));
vi.mock('@/lib/stellar/supply', () => ({ fetchSupplyDasClasses: st.fetchSupplyDasClasses }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: vi.fn(), registerOnChainHash: vi.fn() }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: vi.fn() }));

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { incorporarCota } from '@/lib/services/tokenizacao';
import { resetNavSupplyCache } from '@/lib/services/nav-supply';
import { bytesCanonicos } from '@/lib/services/json-canonico';
import { assetCode } from '@/lib/stellar/config';
import { memoDaIncorporacao, montarEvidencia, paraMarkdown, type Fontes, type TxLida } from '../../scripts/evidencia-cota/core';
import { montarComprovante } from '@/lib/integrations/psp/comprovante';

const HASH = 'b'.repeat(64);
const base = {
  tipoBem: 'VEICULO' as never,
  administradora: 'X',
  valorCarta: '500',
  desagioAquisicao: '0.20', // V = 400,00
  operador: 'admin',
  hashValidacao: HASH,
};
const supply = (c: string) => ({ circulante: new Prisma.Decimal(c), tesouraria: new Prisma.Decimal('0') }) as never;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PII = { nome: 'Fulana Silva Teste', cpf: '52998224725', chavePix: 'fulana.pix@exemplo.test', email: 'fulana.lead@exemplo.test' };

async function evento() {
  return db.eventoAudit.findFirstOrThrow({ where: { acao: 'COTA_INCORPORADA' } });
}
async function semearCessao(opts: { cessao: 'ASSINADA' | 'PENDENTE'; pix?: 'COMPROVADA' | 'FALHOU' | 'ENVIANDO' | null; id: string }) {
  const lead = await db.leadVendedor.create({ data: { nome: PII.nome, email: PII.email, cpf: PII.cpf } });
  const oferta = await db.oferta.create({
    data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '500.00', administradora: 'Adm Teste', desagioAquisicao: '0.2000', valorLiquidoVendedor: '400.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' },
  });
  await db.cessao.create({
    data: { id: opts.id, ofertaId: oferta.id, status: opts.cessao, hashDocumento: opts.cessao === 'ASSINADA' ? 'c'.repeat(64) : null } as never,
  });
  if (opts.pix) {
    await db.transferenciaPix.create({
      data: {
        cessaoId: opts.id, idempotencyKey: `pix-cedente:${opts.id}`, provedor: 'SIMULADO', status: opts.pix, valor: '400.00',
        destinoMascarado: 'CPF ***4725', comprovanteSha256: opts.pix === 'COMPROVADA' ? 'd'.repeat(64) : null,
        ancoraTxHash: opts.pix === 'COMPROVADA' ? 'e'.repeat(64) : null,
      },
    });
  }
}


/** Funil realista: PDF assinado (bytes) + comprovante canônico do E1-2 (bytes com `valor`) + txs de âncora com memo = sha256 dos bytes. */
const arquivos = new Map<string, { pdf: Buffer; pdfSha: string; comp: Buffer; compSha: string }>();
const memosExtras = new Map<string, string>(); // txHash → memo hex (âncoras da cessão e do Pix, tx do laudo)
async function semearFunil(opts: { id: string; cessao: 'ASSINADA' | 'PENDENTE'; pix: 'COMPROVADA' | 'ENVIANDO'; valorComprovante?: string }) {
  const pdf = Buffer.from(`%PDF-qa-${opts.id}`);
  const pdfSha = sha(pdf);
  const { bytes: comp, sha256: compSha } = montarComprovante({
    provedor: 'SIMULADO', transferenciaId: `t_${opts.id}`, e2eId: `E2E${opts.id}`, valor: opts.valorComprovante ?? '400.00',
    efetivadoEm: '2026-11-13T12:00:00.000Z', destino: 'CPF ***4725', cessaoId: opts.id, referencia: `pix-cedente:${opts.id}`,
  });
  arquivos.set(opts.id, { pdf, pdfSha, comp, compSha });
  memosExtras.set(`cessaotx_${opts.id}`, pdfSha);
  memosExtras.set(`pixtx_${opts.id}`, compSha);
  const lead = await db.leadVendedor.create({ data: { nome: PII.nome, email: PII.email, cpf: PII.cpf } });
  const oferta = await db.oferta.create({
    data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '500.00', administradora: 'Adm Teste', desagioAquisicao: '0.2000', valorLiquidoVendedor: '400.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' },
  });
  await db.cessao.create({ data: { id: opts.id, ofertaId: oferta.id, status: opts.cessao, hashDocumento: pdfSha, onChainTxHash: `cessaotx_${opts.id}` } as never });
  await db.transferenciaPix.create({
    data: {
      cessaoId: opts.id, idempotencyKey: `pix-cedente:${opts.id}`, provedor: 'SIMULADO', status: opts.pix, valor: '400.00', e2eId: `E2E${opts.id}`,
      destinoMascarado: 'CPF ***4725', comprovante: comp.toString('utf8'), comprovanteSha256: compSha, ancoraTxHash: `pixtx_${opts.id}`,
    },
  });
}
/** Estado "anterior à prova": cessão não assinada / Pix não comprovado (o registro nasce sem os elos). */
const provar = async (id: string) => {
  await db.$executeRawUnsafe(`UPDATE "Cessao" SET status = 'ASSINADA' WHERE id = '${id}'`);
  await db.$executeRawUnsafe(`UPDATE "TransferenciaPix" SET status = 'COMPROVADA' WHERE "cessaoId" = '${id}'`);
};

/** Mesmo mapeamento do CLI (scripts/evidencia-cota.ts); Horizon falso coerente com o que o produtor e o funil fizeram. */
const fontes: Fontes = {
  hashPayload: () => HASH,
  ativo: () => ({ code: assetCode, issuer: ISSUER_PK }),
  async registroIncorporacao(cotaId) {
    const ev = await db.eventoAudit.findFirst({ where: { cotaId, acao: 'COTA_INCORPORADA' }, select: { payloadJson: true, payloadHash: true } });
    const p = ev?.payloadJson as { registroCanonico?: unknown; ancoraTxHash?: string } | null | undefined;
    if (!p?.registroCanonico) return null;
    return { bytes: bytesCanonicos(p.registroCanonico), hashRegistrado: ev?.payloadHash ?? null, txHash: p.ancoraTxHash ?? null };
  },
  async cota(id) {
    const c = await db.cota.findUnique({ where: { id } });
    return c && { id: c.id, cessaoId: c.cessaoId, hashValidacao: c.hashValidacao, validacaoTxHash: c.validacaoTxHash, emissaoTxHash: c.emissaoTxHash, tokensEmitidos: c.tokensEmitidos.toString() };
  },
  laudo: async () => ({ payloadJson: {}, payloadHash: HASH }),
  cessao: (id) => db.cessao.findUnique({ where: { id }, select: { status: true, hashDocumento: true, onChainTxHash: true } }),
  pdfCessao: async (id) => arquivos.get(id)?.pdf ?? null,
  async pagamento(id) {
    const t = await db.transferenciaPix.findUnique({ where: { cessaoId: id }, select: { status: true, ancoraTxHash: true, comprovanteSha256: true, e2eId: true } });
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
  async tx() { return null; }, // substituído em cada chamada (ver conferir)
};
const passo = (e: Awaited<ReturnType<typeof montarEvidencia>>, id: string) => e.passos.find((p) => p.passo === id)!;

describe.skipIf(!PG)('E1-P — contrato produtor (incorporarCota) ↔ verificador (evidencia:cota) com Postgres real', () => {
  beforeAll(() => {
    process.env.STELLAR_ISSUER_SECRET = 'S-test';
    process.env.STELLAR_PLINA_POSITION_PUBLIC = Keypair.random().publicKey();
  });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.calls = []; st.chain = new Map(); st.built = []; st.submitScript = []; st.ancoras = []; st.ancoraMapa = new Map();
    st.ancoraFalha = null; st.porMemo = null; arquivos.clear(); memosExtras.clear();
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
    resetNavSupplyCache();
    await db.$executeRawUnsafe('TRUNCATE "TentativaEmissao", "MovimentoFundo", "EventoAudit", "Cota", "TransferenciaPix", "Cessao", "Oferta", "LeadVendedor" RESTART IDENTITY CASCADE');
    await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', payloadHash: HASH, stellarTxHash: 'txLaudo' } });
    await db.eventoAudit.create({ data: { acao: 'ANUENCIA_REGISTRADA', payloadJson: { hashValidacao: HASH, status: 'DECLARADA_PENDENTE' } } });
  });
  /** Horizon falso: âncora do registro (memo = sha256 do registro), laudo, cessão, Pix e emissão (payment do issuer; memo = chave de incorporação). */
  const conferir = async (cotaId: string, o?: { ancoraDepois?: boolean }) => {
    const cota = await db.cota.findUniqueOrThrow({ where: { id: cotaId } });
    const chave = cota.cessaoId ?? HASH;
    const f: Fontes = {
      ...fontes,
      async tx(hash): Promise<TxLida | null> {
        const par = [...st.ancoraMapa.entries()].find(([, tx]) => tx === hash);
        if (par) return { sucesso: true, memoHex: par[0], ordem: o?.ancoraDepois ? '1000' : '100' };
        if (hash === 'txLaudo') return { sucesso: true, memoHex: HASH, ordem: '10' };
        const extra = memosExtras.get(hash);
        if (extra) return { sucesso: true, memoHex: extra, ordem: '50' };
        const b = st.built.find((x) => x.hash === hash);
        if (b && st.chain.get(hash)?.successful) {
          return { sucesso: true, memoHex: memoDaIncorporacao(chave), ordem: '500', pagamentos: [{ asset: `${assetCode}:${ISSUER_PK}`, amount: b.amount, from: ISSUER_PK, to: 'GPOS' }] };
        }
        return null;
      },
    };
    return montarEvidencia(cotaId, f);
  };

  it('o que o produtor grava, o verificador confere: incorporação (registro + âncora antes da emissão)', async () => {
    const r = await incorporarCota(base);
    const e = await conferir(r.cotaId);
    expect(passo(e, 'INCORPORACAO')).toMatchObject({ confere: true });
    expect(e.classificacao).toBe('LEGADA'); // sem cessão: nunca "cadeia completa"
  });

  it('FUNIL COMPLETO (cessão ASSINADA + Pix COMPROVADO com comprovante real do E1-2): os 5 passos conferem, CADEIA_COMPLETA, e o relatório não carrega PII', async () => {
    await semearFunil({ id: 'cessao_f', cessao: 'ASSINADA', pix: 'COMPROVADA' });
    const r = await incorporarCota({ ...base, cessaoId: 'cessao_f', pixValorBrl: '400.00' });
    const e = await conferir(r.cotaId);
    expect(e.passos.map((x) => `${x.passo}:${x.confere}`)).toEqual(['VALIDACAO:true', 'CESSAO:true', 'LIQUIDACAO:true', 'INCORPORACAO:true', 'EMISSAO:true']);
    expect(e.classificacao).toBe('CADEIA_COMPLETA');
    const saida = JSON.stringify(e) + paraMarkdown(e);
    for (const v of [PII.nome, PII.cpf, PII.email, '***4725', 'fulana']) expect(saida).not.toContain(v);
    // os elos do registro são exatamente os hashes dos passos 2 e 3
    const reg = ((await evento()).payloadJson as any).registroCanonico;
    expect(reg.sha256PdfCessao).toBe(passo(e, 'CESSAO').sha256Documento);
    expect(reg.comprovantePixSha256).toBe(passo(e, 'LIQUIDACAO').sha256Documento);
    expect(reg.comprovantePixAncoraTxHash).toBe(passo(e, 'LIQUIDACAO').txHash);
  });

  it('F-EP-2 (retest 67a1206): incorporar com o registro SEM os elos (cessão não assinada / Pix não comprovado na hora) e as provas aparecerem depois NÃO confere: REGISTRO_INCOMPLETO, INCOMPLETA', async () => {
    await semearFunil({ id: 'cessao_b', cessao: 'PENDENTE', pix: 'ENVIANDO' });
    const r = await incorporarCota({ ...base, cessaoId: 'cessao_b', pixValorBrl: '400.00' });
    await provar('cessao_b');
    expect((await evento()).payloadJson).toMatchObject({ registroCanonico: { sha256PdfCessao: null, comprovantePixSha256: null } });
    const e = await conferir(r.cotaId);
    const p = passo(e, 'INCORPORACAO');
    expect(p.confere).toBe(false);
    expect(p.motivo).toContain('REGISTRO_INCOMPLETO');
    expect(e.classificacao).toBe('INCOMPLETA');
  });

  it('elo errado: se o Pix (comprovante) mudou depois do registro, o passo 3 e o elo reprovam e a cadeia fica INCOMPLETA', async () => {
    await semearFunil({ id: 'cessao_e', cessao: 'ASSINADA', pix: 'COMPROVADA' });
    const r = await incorporarCota({ ...base, cessaoId: 'cessao_e', pixValorBrl: '400.00' });
    // outro comprovante (outro valor) passa a ser o guardado e a âncora dele
    const { bytes, sha256: outro } = montarComprovante({ provedor: 'SIMULADO', transferenciaId: 't2', e2eId: 'E2E2', valor: '400.00', efetivadoEm: '2026-11-14T00:00:00.000Z', destino: 'CPF ***4725', cessaoId: 'cessao_e', referencia: 'x' });
    memosExtras.set('pixtx_cessao_e', outro);
    await db.$executeRawUnsafe(`UPDATE "TransferenciaPix" SET comprovante = '${bytes.toString('utf8').replace(/'/g, "''")}', "comprovanteSha256" = '${outro}' WHERE "cessaoId" = 'cessao_e'`);
    arquivos.get('cessao_e')!.comp = bytes;
    const e = await conferir(r.cotaId);
    expect(passo(e, 'INCORPORACAO').confere).toBe(false);
    expect(passo(e, 'INCORPORACAO').motivo).toContain('REGISTRO_DIVERGE: comprovantePixSha256');
    expect(e.classificacao).toBe('INCOMPLETA');
  });

  it('valor do comprovante ≠ valor incorporado (APORTE_COTA): LIQUIDACAO_VALOR_DIVERGE', async () => {
    await semearFunil({ id: 'cessao_v', cessao: 'ASSINADA', pix: 'COMPROVADA', valorComprovante: '399.00' });
    const r = await incorporarCota({ ...base, cessaoId: 'cessao_v', pixValorBrl: '400.00' });
    const e = await conferir(r.cotaId);
    expect(passo(e, 'LIQUIDACAO').confere).toBe(false);
    expect(passo(e, 'LIQUIDACAO').motivo).toContain('LIQUIDACAO_VALOR_DIVERGE');
    expect(e.classificacao).toBe('INCOMPLETA');
  });

  it('comprovante sem "valor" legível: COMPROVANTE_ILEGIVEL (nunca confere por omissão)', async () => {
    await semearFunil({ id: 'cessao_i', cessao: 'ASSINADA', pix: 'COMPROVADA' });
    const r = await incorporarCota({ ...base, cessaoId: 'cessao_i', pixValorBrl: '400.00' });
    const txt = '{"tipo":"x"}';
    const sha2 = sha(Buffer.from(txt));
    memosExtras.set('pixtx_cessao_i', sha2);
    await db.$executeRawUnsafe(`UPDATE "TransferenciaPix" SET comprovante = '${txt}', "comprovanteSha256" = '${sha2}' WHERE "cessaoId" = 'cessao_i'`);
    const e = await conferir(r.cotaId);
    expect(passo(e, 'LIQUIDACAO').motivo).toContain('COMPROVANTE_ILEGIVEL');
  });

  it('depois de erro ambíguo + recuperação o verificador continua conferindo (âncora reencontrada, mesmos números)', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    st.chain.set('hash1', { successful: true });
    const r = await incorporarCota(base);
    expect(passo(await conferir(r.cotaId), 'INCORPORACAO').confere).toBe(true);
  });

  it('adulteração no banco depois do fato: registro mudado reprova (DOCUMENTO_DIVERGE_DO_REGISTRO); aporte mudado reprova (REGISTRO_DIVERGE)', async () => {
    const r = await incorporarCota(base);
    await db.$executeRawUnsafe(`UPDATE "EventoAudit" SET "payloadJson" = jsonb_set("payloadJson", '{registroCanonico,tokensEmitir}', '"999.0000000"') WHERE acao = 'COTA_INCORPORADA'`);
    const p = passo(await conferir(r.cotaId), 'INCORPORACAO');
    expect(p.confere).toBe(false);
    expect(p.motivo).toContain('DOCUMENTO_DIVERGE_DO_REGISTRO');
    await db.$executeRawUnsafe(`UPDATE "EventoAudit" SET "payloadJson" = jsonb_set("payloadJson", '{registroCanonico,tokensEmitir}', '"400.0000000"') WHERE acao = 'COTA_INCORPORADA'`);
    expect(passo(await conferir(r.cotaId), 'INCORPORACAO').confere).toBe(true);
    await db.$executeRawUnsafe(`UPDATE "MovimentoFundo" SET "valorBrl" = 399 WHERE tipo = 'APORTE_COTA'`);
    const q = passo(await conferir(r.cotaId), 'INCORPORACAO');
    expect(q.confere).toBe(false);
    expect(q.motivo).toContain('REGISTRO_DIVERGE: valor ≠ aporte');
  });

  it('âncora que entrou DEPOIS da emissão no ledger reprova (ANCORA_NAO_ANTES_DA_EMISSAO)', async () => {
    const r = await incorporarCota(base);
    const p = passo(await conferir(r.cotaId, { ancoraDepois: true }), 'INCORPORACAO');
    expect(p.confere).toBe(false);
    expect(p.motivo).toContain('ANCORA_NAO_ANTES_DA_EMISSAO');
  });

  it('emissão legada (achada só pelo memo): sem registro → SEM_REGISTRO_INCORPORACAO (nunca "confere")', async () => {
    st.porMemo = { txHash: 'txlegado', amount: '400.0000000' };
    const r = await incorporarCota(base);
    const p = passo(await conferir(r.cotaId), 'INCORPORACAO');
    expect(p.confere).toBe(false);
    expect(p.motivo).toContain('SEM_REGISTRO_INCORPORACAO');
  });

  it('o registro não vale para OUTRA cota: cotaId trocado dentro do evento reprova', async () => {
    const r = await incorporarCota(base);
    await db.$executeRawUnsafe(`UPDATE "EventoAudit" SET "payloadJson" = jsonb_set("payloadJson", '{registroCanonico,cotaId}', '"inc_outra"') WHERE acao = 'COTA_INCORPORADA'`);
    expect(passo(await conferir(r.cotaId), 'INCORPORACAO').confere).toBe(false);
  });
});
