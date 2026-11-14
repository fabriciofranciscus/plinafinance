/**
 * QA Vera — E1-P: registro canônico da incorporação ancorado ANTES da emissão, com o Postgres REAL e o registro REAL
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
  ancoraArgs: [] as Array<{ semEspera?: boolean; sha256Hex: string }>,
  ancoras: [] as Array<{ sha256Hex: string; contexto: string; desde: Date; reutilizada: boolean; txHash: string }>,
  ancoraMapa: new Map<string, string>(),
  ancoraFalha: null as Error | null,
  /** I1 (962854d): âncora com desfecho AMBÍGUO (semEspera) — 'entra' = a tx entra no ledger mesmo assim; 'nao' = não entra. */
  ancoraAmbigua: null as null | 'entra' | 'nao',
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
  ancorarSha256: vi.fn(async (i: { sha256Hex: string; contexto: string; desde: Date; semEspera?: boolean }) => {
    st.calls.push('ancora');
    st.ancoraArgs.push(i);
    if (st.ancoraFalha) throw st.ancoraFalha;
    if (st.ancoraAmbigua) {
      if (st.ancoraAmbigua === 'entra' && !st.ancoraMapa.has(i.sha256Hex)) st.ancoraMapa.set(i.sha256Hex, `ancoratx${st.ancoraMapa.size + 1}`);
      throw Object.assign(new Error('âncora ambígua'), { code: 'ANCORA_NAO_CONFIRMADA' });
    }
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
async function semearCessao(opts: { cessao: 'ASSINADA' | 'PENDENTE'; pix?: 'COMPROVADA' | 'FALHOU' | null; id: string }) {
  const lead = await db.leadVendedor.create({ data: { nome: PII.nome, email: `${opts.id}.${PII.email}`, cpf: PII.cpf } });
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

describe.skipIf(!PG)('E1-P — registro canônico da incorporação ancorado antes da emissão (Postgres real)', () => {
  beforeAll(() => {
    process.env.STELLAR_ISSUER_SECRET = 'S-test';
    process.env.STELLAR_PLINA_POSITION_PUBLIC = Keypair.random().publicKey();
  });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.calls = []; st.chain = new Map(); st.built = []; st.submitScript = []; st.ancoras = []; st.ancoraMapa = new Map();
    st.ancoraFalha = null; st.ancoraAmbigua = null; st.ancoraArgs = []; st.porMemo = null;
    st.fetchSupplyDasClasses.mockReset().mockResolvedValue({ senior: supply('0'), subordinada: supply('0') });
    resetNavSupplyCache();
    await db.$executeRawUnsafe(
      'TRUNCATE "TentativaEmissao", "MovimentoFundo", "EventoAudit", "Cota", "TransferenciaPix", "Cessao", "Oferta", "LeadVendedor" RESTART IDENTITY CASCADE',
    );
    await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', payloadHash: HASH, stellarTxHash: 'txLaudo' } });
    await db.eventoAudit.create({ data: { acao: 'ANUENCIA_REGISTRADA', payloadJson: { hashValidacao: HASH, status: 'DECLARADA_PENDENTE' } } });
  });

  it('feliz: ancora ANTES de construir/enviar; payloadHash = SHA-256 dos bytes canônicos do registro gravado = memo da âncora', async () => {
    const r = await incorporarCota(base);
    expect(st.calls).toEqual(['ancora', 'build', 'submit']);
    expect(st.ancoras).toHaveLength(1);
    expect(st.ancoras[0].contexto).toBe('COTA_INCORPORADA');
    const ev = await evento();
    const pj = ev.payloadJson as Record<string, any>;
    // reserializar o objeto que veio do jsonb reproduz os mesmos bytes (RFC 8785 é função do valor)
    expect(sha(bytesCanonicos(pj.registroCanonico))).toBe(ev.payloadHash);
    expect(ev.payloadHash).toBe(st.ancoras[0].sha256Hex);
    expect(pj.ancoraTxHash).toBe(st.ancoras[0].txHash);
    expect(pj.registroCanonico).toMatchObject({
      tipo: 'COTA_INCORPORADA', versao: 1, cotaId: r.cotaId, hashLaudo: HASH, cessaoId: null,
      sha256PdfCessao: null, comprovantePixSha256: null, comprovantePixAncoraTxHash: null,
      valorIncorporadoBrl: '400.00', tokensEmitir: '400.0000000', navPorTokenUsado: '1.00000000', issuer: ISSUER_PK, asset: expect.any(String),
    });
    // os números do registro são os da tx emitida
    expect(st.built[0].amount).toBe(pj.registroCanonico.tokensEmitir);
    expect(ev.stellarTxHash).toBe(r.txHash);
  });

  it('com cessão ASSINADA e Pix COMPROVADO: o registro amarra o PDF do DS3 e o comprovante (sha + âncora); com cessão PENDENTE e Pix FALHOU: nulos (não amarra prova que não existe)', async () => {
    await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_ok' });
    await incorporarCota({ ...base, cessaoId: 'cessao_ok', pixValorBrl: '400.00' });
    const pj = (await evento()).payloadJson as Record<string, any>;
    expect(pj.registroCanonico).toMatchObject({
      cessaoId: 'cessao_ok', sha256PdfCessao: 'c'.repeat(64), comprovantePixSha256: 'd'.repeat(64), comprovantePixAncoraTxHash: 'e'.repeat(64),
    });

    await db.$executeRawUnsafe('TRUNCATE "TentativaEmissao", "MovimentoFundo", "EventoAudit", "Cota", "TransferenciaPix", "Cessao", "Oferta", "LeadVendedor" RESTART IDENTITY CASCADE');
    await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', payloadHash: HASH, stellarTxHash: 'txLaudo' } });
    await db.eventoAudit.create({ data: { acao: 'ANUENCIA_REGISTRADA', payloadJson: { hashValidacao: HASH, status: 'DECLARADA_PENDENTE' } } });
    st.ancoraMapa = new Map(); st.chain = new Map(); st.built = [];
    await semearCessao({ cessao: 'PENDENTE', pix: 'FALHOU', id: 'cessao_ruim' });
    await incorporarCota({ ...base, cessaoId: 'cessao_ruim', pixValorBrl: '400.00' });
    const pj2 = (await evento()).payloadJson as Record<string, any>;
    expect(pj2.registroCanonico).toMatchObject({ cessaoId: 'cessao_ruim', sha256PdfCessao: null, comprovantePixSha256: null, comprovantePixAncoraTxHash: null });
  });

  it('sem PII: nem o registro, nem o payload do evento, nem o que foi ancorado carregam nome, CPF, chave Pix ou e-mail do cedente', async () => {
    await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_pii' });
    await incorporarCota({ ...base, cessaoId: 'cessao_pii', pixValorBrl: '400.00' });
    const ev = await evento();
    const txt = JSON.stringify(ev);
    for (const v of Object.values(PII)) expect(txt).not.toContain(v);
    expect(txt).not.toContain('***4725');
  });

  it('âncora FALHA: IncorporacaoBloqueada ANCORA_INCORPORACAO_FALHOU, NADA é construído/enviado nem gravado (sem Cota, sem evento, sem tentativa, sem movimento)', async () => {
    st.ancoraFalha = new Error('horizon fora');
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'ANCORA_INCORPORACAO_FALHOU' });
    expect(st.calls).toEqual(['ancora']);
    expect(await db.cota.count()).toBe(0);
    expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(0);
    expect(await db.tentativaEmissao.count()).toBe(0);
    expect(await db.movimentoFundo.count()).toBe(0);
    // a mensagem ao chamador não vaza a causa
    const e = (await incorporarCota(base).catch((x: unknown) => x)) as Error;
    expect(e.message).not.toContain('horizon fora');
    // volta o Horizon: a mesma chamada emite normalmente
    st.ancoraFalha = null;
    await expect(incorporarCota(base)).resolves.toMatchObject({ tokensEmitidos: 400 });
  });

  it('emissão RECUSADA (FAILED) depois da âncora: nada de domínio; a nova tentativa com os mesmos números REUSA a âncora (mesmo hash, 1 só tx de âncora)', async () => {
    st.submitScript = ['FAILED'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_FALHOU' });
    expect(await db.cota.count()).toBe(0);
    expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(0);
    await incorporarCota(base);
    expect(st.ancoras).toHaveLength(2);
    expect(st.ancoras[1].sha256Hex).toBe(st.ancoras[0].sha256Hex);
    expect(st.ancoras[1].reutilizada).toBe(true);
    expect(st.ancoraMapa.size).toBe(1);
  });

  it('erro ambíguo + recuperação: a recuperação re-deriva o MESMO hash (números da TENTATIVA, não recalculados), mesmo que o supply tenha mudado, e usa desde = criação da tentativa', async () => {
    st.submitScript = ['AMBIGUOUS'];
    await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
    const hashAntes = st.ancoras[0].sha256Hex;
    const tentativa = await db.tentativaEmissao.findFirstOrThrow();
    // a tx entrou; o ledger agora tem OUTRO supply (se recalculasse, o NAV/q seriam outros)
    st.chain.set('hash1', { successful: true });
    st.fetchSupplyDasClasses.mockResolvedValue({ senior: supply('999'), subordinada: supply('0') });
    resetNavSupplyCache();
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    const ultima = st.ancoras[st.ancoras.length - 1];
    expect(ultima.sha256Hex).toBe(hashAntes);
    expect(ultima.reutilizada).toBe(true);
    expect(ultima.desde.getTime()).toBe(tentativa.criadaEm.getTime());
    const ev = await evento();
    expect(ev.payloadHash).toBe(hashAntes);
    expect(sha(bytesCanonicos((ev.payloadJson as any).registroCanonico))).toBe(hashAntes);
    expect(st.built).toHaveLength(1); // nenhuma 2ª emissão
    expect(st.ancoraMapa.size).toBe(1); // nenhuma 2ª âncora
  });

  it('emissão achada só pelo memo (anterior à tabela de tentativas): NÃO inventa registro — sem payloadHash, sem âncora', async () => {
    st.porMemo = { txHash: 'txlegado', amount: '400.0000000' };
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('txlegado');
    expect(st.calls).not.toContain('ancora');
    const ev = await evento();
    expect(ev.payloadHash).toBeNull();
    expect((ev.payloadJson as any).registroCanonico).toBeUndefined();
  });

  it('reexecução depois de incorporada: devolve a Cota existente, sem nova âncora nem nova emissão', async () => {
    await incorporarCota(base);
    const antes = st.ancoras.length;
    const r = await incorporarCota(base);
    expect(r.txHash).toBe('hash1');
    expect(st.ancoras).toHaveLength(antes);
    expect(st.built).toHaveLength(1);
    expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(1);
  });

  it('chamadas simultâneas: o advisory lock serializa — UMA âncora, UMA emissão, UM evento', async () => {
    const r = await Promise.all([incorporarCota(base), incorporarCota(base), incorporarCota(base)]);
    expect(new Set(r.map((x) => x.cotaId)).size).toBe(1);
    expect(st.ancoras).toHaveLength(1);
    expect(st.built).toHaveLength(1);
    expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(1);
  });

  describe('runbook incorporar-cota-timeout (Farol): a emissão saiu, o banco falhou, o operador chama DE NOVO o mesmo incorporar-cota', () => {
    const quebrarGravacao = async () => {
      await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION vera_quebra_incorp() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'vera: queda simulada na gravação'; END; $$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS vera_quebra_incorp ON "EventoAudit"');
      await db.$executeRawUnsafe(`CREATE TRIGGER vera_quebra_incorp BEFORE INSERT ON "EventoAudit" FOR EACH ROW WHEN (NEW.acao = 'COTA_INCORPORADA') EXECUTE FUNCTION vera_quebra_incorp()`);
    };
    const consertar = () => db.$executeRawUnsafe('DROP TRIGGER IF EXISTS vera_quebra_incorp ON "EventoAudit"');

    it('1ª chamada: tx entra na rede mas a gravação do banco cai ⇒ erro (500), nada de domínio, NAV indisponível; 2ª chamada (mesma cessão): NÃO emite de novo, recupera, cria a Cota/aporte/evento uma vez, reusa a âncora e o NAV volta', async () => {
      await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_rb' });
      const entrada = { ...base, cessaoId: 'cessao_rb', pixValorBrl: '400.00' };
      await quebrarGravacao();
      try {
        await expect(incorporarCota(entrada)).rejects.toThrow();
      } finally { await consertar(); }
      expect(st.built).toHaveLength(1);
      expect(st.chain.get('hash1')?.successful).toBe(true); // a emissão JÁ saiu
      expect(await db.cota.count()).toBe(0);
      expect(await db.movimentoFundo.count({ where: { tipo: 'APORTE_COTA' } })).toBe(0);
      expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(0);
      const t1 = await db.tentativaEmissao.findFirstOrThrow();
      expect(t1.aplicadaEm).toBeNull();
      // enquanto isso o NAV fica indisponível (é o 503 do /api/pool/summary que o runbook descreve)
      resetNavSupplyCache();
      const { lerSupplyDoNav } = await import('@/lib/services/nav-supply');
      await expect(lerSupplyDoNav({ fresh: true })).rejects.toMatchObject({ motivo: 'EMISSAO_PENDENTE' });
      const hashAntes = st.ancoras[0].sha256Hex;

      const r = await incorporarCota(entrada); // "chame de novo o MESMO incorporar-cota da MESMA cessão"
      expect(r.txHash).toBe('hash1');
      expect(st.built).toHaveLength(1);        // nenhuma 2ª emissão
      expect(await db.cota.count()).toBe(1);
      expect(await db.movimentoFundo.count({ where: { tipo: 'APORTE_COTA' } })).toBe(1);
      expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(1);
      expect((await evento()).payloadHash).toBe(hashAntes);
      expect(st.ancoraMapa.size).toBe(1);      // nenhuma 2ª âncora
      expect((await db.tentativaEmissao.findFirstOrThrow()).aplicadaEm).toBeInstanceOf(Date);
      resetNavSupplyCache();
      await expect(lerSupplyDoNav({ fresh: true })).resolves.toBeDefined(); // o NAV volta
    });

    it('chamar uma 3ª vez depois de recuperada é inofensivo (devolve a Cota existente, sem nova emissão/âncora)', async () => {
      await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_rb2' });
      const entrada = { ...base, cessaoId: 'cessao_rb2', pixValorBrl: '400.00' };
      await quebrarGravacao();
      try { await incorporarCota(entrada).catch(() => undefined); } finally { await consertar(); }
      const a = await incorporarCota(entrada);
      const b = await incorporarCota(entrada);
      expect(b.cotaId).toBe(a.cotaId);
      expect(st.built).toHaveLength(1);
      expect(st.ancoraMapa.size).toBe(1);
      expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(1);
    });

    it('o caminho que o runbook proíbe (recriar a cessão = outra chave de incorporação) NÃO duplica a emissão enquanto a tentativa anterior está pendente: o gate do NAV (EMISSAO_PENDENTE) trava a 2ª emissão — nada é emitido e o NAV segue indisponível até recuperar a ORIGINAL', async () => {
      await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_orig' });
      await quebrarGravacao();
      try { await incorporarCota({ ...base, cessaoId: 'cessao_orig', pixValorBrl: '400.00' }).catch(() => undefined); } finally { await consertar(); }
      expect(st.built).toHaveLength(1);
      await semearCessao({ cessao: 'ASSINADA', pix: 'COMPROVADA', id: 'cessao_nova' });
      const e = await incorporarCota({ ...base, cessaoId: 'cessao_nova', pixValorBrl: '400.00' }).then(() => null, (x: unknown) => x as Error & { motivo?: string });
      expect(e).not.toBeNull();
      expect(e!.motivo ?? e!.message).toMatch(/EMISSAO_PENDENTE|NAV indispon/);
      expect(st.built).toHaveLength(1); // nenhuma 2ª emissão
      expect(await db.cota.count()).toBe(0);
      // a recuperação pela cessão ORIGINAL continua funcionando
      const r = await incorporarCota({ ...base, cessaoId: 'cessao_orig', pixValorBrl: '400.00' });
      expect(r.txHash).toBe('hash1');
      expect(await db.cota.count()).toBe(1);
    });
  });

  describe('I1 (962854d): a âncora da incorporação NÃO espera dentro da $transaction', () => {
    it('toda chamada da âncora feita por incorporarCota passa semEspera:true', async () => {
      await incorporarCota(base);
      expect(st.ancoraArgs.length).toBeGreaterThan(0);
      expect(st.ancoraArgs.every((a) => a.semEspera === true)).toBe(true);
    });

    it('âncora AMBÍGUA: EMISSAO_EM_ANDAMENTO na hora; nada é construído/enviado nem gravado (sem tentativa ⇒ o NAV NÃO fica travado); mensagem sem a causa', async () => {
      st.ancoraAmbigua = 'nao';
      const t0 = Date.now();
      const e = (await incorporarCota(base).catch((x: unknown) => x)) as Error & { code?: string };
      expect(Date.now() - t0).toBeLessThan(5000); // não espera ~130 s
      expect(e.code).toBe('EMISSAO_EM_ANDAMENTO');
      expect(e.message).not.toContain('ambígua');
      expect(st.calls).toEqual(['ancora']);
      expect(await db.cota.count()).toBe(0);
      expect(await db.tentativaEmissao.count()).toBe(0);
      expect(await db.eventoAudit.count({ where: { acao: 'COTA_INCORPORADA' } })).toBe(0);
      expect(await db.movimentoFundo.count()).toBe(0);
      resetNavSupplyCache();
      const { lerSupplyDoNav } = await import('@/lib/services/nav-supply');
      await expect(lerSupplyDoNav({ fresh: true })).resolves.toBeDefined();
    });

    it('a âncora ambígua ENTROU no ledger: a próxima chamada a reencontra pelo hash (reutilizada, 1 só âncora), emite UMA vez e o evento aponta essa âncora', async () => {
      st.ancoraAmbigua = 'entra';
      await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
      const hash = [...st.ancoraMapa.keys()][0];
      st.ancoraAmbigua = null;
      const r = await incorporarCota(base);
      expect(r.txHash).toBe('hash1');
      expect(st.ancoraMapa.size).toBe(1);
      expect(st.ancoras[st.ancoras.length - 1]).toMatchObject({ sha256Hex: hash, reutilizada: true });
      expect(st.built).toHaveLength(1);
      const ev = await evento();
      expect(ev.payloadHash).toBe(hash);
      expect(sha(bytesCanonicos((ev.payloadJson as any).registroCanonico))).toBe(hash);
    });

    it('a âncora ambígua NÃO entrou: a próxima chamada ancora de novo e emite UMA vez; nunca 2 emissões', async () => {
      st.ancoraAmbigua = 'nao';
      await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'EMISSAO_EM_ANDAMENTO' });
      expect(st.ancoraMapa.size).toBe(0);
      st.ancoraAmbigua = null;
      await incorporarCota(base);
      expect(st.built).toHaveLength(1);
      expect(st.ancoraMapa.size).toBe(1);
      expect(await db.cota.count()).toBe(1);
    });

    it('falha DEFINITIVA da âncora (não ambígua) continua ANCORA_INCORPORACAO_FALHOU (não vira "em andamento")', async () => {
      st.ancoraFalha = Object.assign(new Error('recusada'), { code: 'ANCORA_FALHOU' });
      await expect(incorporarCota(base)).rejects.toMatchObject({ code: 'ANCORA_INCORPORACAO_FALHOU' });
      expect(st.calls).toEqual(['ancora']);
    });

    it('3 chamadas simultâneas com a âncora ambígua: nenhuma emite, nenhuma grava, todas EMISSAO_EM_ANDAMENTO (o lock serializa, sem travar)', async () => {
      st.ancoraAmbigua = 'nao';
      const rs = await Promise.all([1, 2, 3].map(() => incorporarCota(base).catch((x: unknown) => x as { code?: string })));
      expect(rs.every((e) => (e as { code?: string }).code === 'EMISSAO_EM_ANDAMENTO')).toBe(true);
      expect(st.built).toHaveLength(0);
      expect(await db.cota.count()).toBe(0);
    });
  });
});
