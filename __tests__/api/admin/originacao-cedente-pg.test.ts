/**
 * QA (Vera) — rota admin/originacao (D3) COM os serviços reais do E1-2 e Postgres real: confirmar-titular-laudo → pagar-cedente →
 * reabrir-pagamento-cedente, corpo estrito (nada de provedor/valor/chave/documento/operador), mapeamento de erros sem vazar dado, e o
 * caminho legado executar-pix-simulado. Mocks só de fora: sessão/CSRF admin, âncora Stellar, Blob do comprovante e e-mail de alerta.
 * Provedor = SIMULADO (configuração). Opt-in: TEST_PG_URL=postgresql://user@127.0.0.1:PORTA/db
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
  }
  process.env.TITULAR_HMAC_SECRET = 'segredo-hmac-do-titular-de-teste-com-mais-de-32-chars';
  process.env.PIX_MAX_BRL = '50000';
  return url;
});
const st = vi.hoisted(() => ({ incorporar: vi.fn(), criar: vi.fn(), buscar: vi.fn(), pdf: vi.fn(), ancora: vi.fn(), blob: vi.fn(), alerta: vi.fn(), rede: 'TESTNET', admin: true, csrf: null as null | Response }));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: async () => st.admin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: () => st.csrf }));
vi.mock('@/lib/stellar/ancora', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/ancora')>()), ancorarSha256: st.ancora }));
vi.mock('@/lib/integrations/blob/comprovante-psp', async (orig) => ({ ...(await orig<typeof import('@/lib/integrations/blob/comprovante-psp')>()), guardarComprovantePsp: st.blob }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: st.alerta }));
vi.mock('@/lib/integrations/docusign', async (orig) => ({ ...(await orig<typeof import('@/lib/integrations/docusign')>()), criarEnvelope: st.criar, buscarEnvelopePorTransactionId: st.buscar }));
vi.mock('@/lib/comprovante/cessao-pdf', async (orig) => ({ ...(await orig<typeof import('@/lib/comprovante/cessao-pdf')>()), buildCessaoPdf: st.pdf }));
vi.mock('@/lib/stellar/audit', async (orig) => {
  const m = await orig<typeof import('@/lib/stellar/audit')>();
  const { createHash: h } = await import('node:crypto');
  return { ...m, registerOnChainHash: async (p: unknown) => ({ payloadHash: h('sha256').update(JSON.stringify(p)).digest('hex'), txHash: 'e'.repeat(64) }) };
});
vi.mock('@/lib/services/tokenizacao', async (orig) => ({ ...(await orig<typeof import('@/lib/services/tokenizacao')>()), incorporarCota: st.incorporar }));
vi.mock('@/lib/stellar/config', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/config')>()), get STELLAR_NETWORK() { return st.rede; } }));

import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { POST } from '@/app/api/admin/originacao/route';

const CPF = '52998224725';
const LIMPAR = 'TRUNCATE "TransferenciaPix", "Pagamento", "Cessao", "Oferta", "EventoAudit", "LeadVendedor", "Pessoa" RESTART IDENTITY CASCADE';
let seq = 0;
const chamar = async (body: unknown) => { const r = await POST(new Request('http://x/api/admin/originacao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); const texto = await r.text(); let json: any = null; try { json = JSON.parse(texto); } catch { /* texto */ } return { status: r.status, texto, json }; };

async function semear(o: { laudo?: boolean; kyc?: boolean; sintetico?: boolean; semPessoa?: boolean; status?: 'ASSINADA' | 'PENDENTE' } = {}) {
  seq += 1;
  const pessoa = o.semPessoa ? null : await db.pessoa.create({ data: { privyId: `did:privy:d3${seq}`, email: `pessoa${seq}@plina.test`, nome: 'Pessoa Simulada D3', publicKey: `GD3${seq}`.padEnd(56, 'A'), cpfNormalizado: CPF, kycAprovado: o.kyc ?? true, isSyntheticCpf: o.sintetico ?? false } });
  const lead = await db.leadVendedor.create({ data: { nome: 'Lead D3', email: `lead${seq}@plina.test`, pessoaId: pessoa?.id } });
  const oferta = await db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '100000.00', administradora: 'Adm Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '1500.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
  const cessao = await db.cessao.create({ data: { id: `cessao_d3_${seq}`, ofertaId: oferta.id, status: o.status ?? 'ASSINADA' } });
  if (o.laudo !== false) await db.eventoAudit.create({ data: { acao: 'COTA_VALIDADA', operador: 'op:laudo', cessaoId: cessao.id, payloadJson: { cessaoId: cessao.id }, payloadHash: createHash('sha256').update(`laudo-${seq}`).digest('hex') } as never });
  return { cessaoId: cessao.id, leadId: lead.id, pessoaId: pessoa?.id };
}
const atestar = (cessaoId: string) => chamar({ action: 'confirmar-titular-laudo', cessaoId, situacao: 'TITULAR_UNICO', atestado: true });
const efeitos = async () => ({ transferencias: await db.transferenciaPix.count(), pagamentos: await db.pagamento.count(), eventos: await db.eventoAudit.count({ where: { acao: { not: 'COTA_VALIDADA' } } }) });

describe.skipIf(!PG)('rota admin/originacao (D3) com serviços reais — Postgres real', () => {
  afterEach(async () => { await db.$executeRawUnsafe(LIMPAR); vi.restoreAllMocks(); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    st.rede = 'TESTNET'; st.admin = true; st.csrf = null; st.incorporar.mockReset().mockResolvedValue({ cotaId: 'inc_x', txHash: 'h'.repeat(64), tokensEmitidos: 1 });
    st.ancora.mockReset().mockImplementation(async ({ sha256Hex }: { sha256Hex: string }) => ({ txHash: sha256Hex.slice(0, 64), reutilizada: false, ledgerCloseTime: '2026-11-13T12:00:00Z' }));
    st.criar.mockReset().mockResolvedValue({ envelopeId: '11111111-2222-3333-4444-555555555555' }); st.buscar.mockReset().mockResolvedValue(null); st.pdf.mockReset().mockResolvedValue(Buffer.from('%PDF-x'));
    st.blob.mockReset().mockResolvedValue({ pathname: 'comprovantes-psp/x.json' }); st.alerta.mockReset().mockResolvedValue(true);
    delete process.env.PSP_PROVIDER; delete process.env.STELLAR_NETWORK; process.env.PIX_MAX_BRL = '50000';
    await db.$executeRawUnsafe(LIMPAR);
  });

  it('ciclo: confirmar-titular-laudo → pagar-cedente → COMPROVADA (SIMULADO): Pagamento PIX_SIMULADO, audit PIX_SIMULADO_EXECUTADO com operador "admin-panel" (constante do servidor), resposta sem CPF nem dados do cedente; repetir pagar → 409 PAGAMENTO_JA_EXECUTADO', async () => {
    const s = await semear();
    const a = await atestar(s.cessaoId);
    expect(a.status).toBe(200); expect(a.json).toMatchObject({ situacao: 'TITULAR_UNICO', pagamentoAutomatico: true });
    const p = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId });
    expect(p.status).toBe(200); expect(p.json).toMatchObject({ status: 'COMPROVADA' });
    expect((await db.pagamento.findUniqueOrThrow({ where: { cessaoId: s.cessaoId } })).metodo).toBe('PIX_SIMULADO');
    const ev = await db.eventoAudit.findFirstOrThrow({ where: { cessaoId: s.cessaoId, acao: 'PIX_SIMULADO_EXECUTADO' } });
    expect(ev.operador).toBe('admin-panel');
    for (const t of [a.texto, p.texto]) { expect(t).not.toContain(CPF); expect(t).not.toMatch(/Pessoa Simulada|Lead D3|@plina\.test/); }
    const de_novo = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId });
    expect(de_novo.status).toBe(409); expect(de_novo.json.code).toBe('PAGAMENTO_JA_EXECUTADO');
    expect(await db.pagamento.count()).toBe(1);
  });

  it('o atestado grava o operador "admin-panel" e o hashLaudo; nunca o CPF nem o nome', async () => {
    const s = await semear(); await atestar(s.cessaoId);
    const ev = await db.eventoAudit.findFirstOrThrow({ where: { cessaoId: s.cessaoId, acao: 'TITULAR_LAUDO_CONFIRMADO' } });
    expect(ev.operador).toBe('admin-panel');
    expect((ev.payloadJson as { hashLaudo: string }).hashLaudo).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toMatch(new RegExp(`${CPF}|Pessoa Simulada`));
  });

  describe('sem laudo / pré-condições (409 com código fixo, nada gravado)', () => {
    it('sem laudo: atestar → 409 LAUDO_AUSENTE e pagar → 409 LAUDO_AUSENTE, sem transferência, pagamento nem evento', async () => {
      const s = await semear({ laudo: false });
      const a = await atestar(s.cessaoId); expect(a.status).toBe(409); expect(a.json.code).toBe('LAUDO_AUSENTE');
      const p = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId }); expect(p.status).toBe(409); expect(p.json.code).toBe('LAUDO_AUSENTE');
      expect(await efeitos()).toEqual({ transferencias: 0, pagamentos: 0, eventos: 0 });
    });
    it('sem atestar o titular: pagar → 409 TITULAR_NAO_CONFIRMADO; KYC não aprovado → 409 KYC_NAO_APROVADO; cessão não ASSINADA → 409 CESSAO_NAO_ASSINADA; sem Pessoa → 409 CEDENTE_SEM_DOCUMENTO', async () => {
      const a = await semear(); expect((await chamar({ action: 'pagar-cedente', cessaoId: a.cessaoId })).json.code).toBe('TITULAR_NAO_CONFIRMADO');
      const b = await semear({ kyc: false }); expect((await chamar({ action: 'pagar-cedente', cessaoId: b.cessaoId })).json.code).toBe('KYC_NAO_APROVADO');
      const c = await semear({ status: 'PENDENTE' }); expect((await chamar({ action: 'pagar-cedente', cessaoId: c.cessaoId })).json.code).toBe('CESSAO_NAO_ASSINADA');
      const d = await semear({ semPessoa: true }); expect((await chamar({ action: 'pagar-cedente', cessaoId: d.cessaoId })).json.code).toBe('CEDENTE_SEM_DOCUMENTO');
      expect((await efeitos()).transferencias).toBe(0);
    });
    it('cessão inexistente → 404 CESSAO_NAO_ENCONTRADA nas 3 ações; segredo do HMAC ausente → 503 SEGREDO_NAO_CONFIGURADO; teto ausente → 503 TETO_NAO_CONFIGURADO', async () => {
      for (const body of [{ action: 'pagar-cedente' }, { action: 'reabrir-pagamento-cedente' }, { action: 'confirmar-titular-laudo', situacao: 'TITULAR_UNICO', atestado: true }]) {
        const r = await chamar({ ...body, cessaoId: 'nao_existe' }); expect(r.status).toBe(404); expect(r.json.code).toBe('CESSAO_NAO_ENCONTRADA');
      }
      const s = await semear(); await atestar(s.cessaoId);
      const seg = process.env.TITULAR_HMAC_SECRET; delete process.env.TITULAR_HMAC_SECRET;
      try { const r = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId }); expect(r.status).toBe(503); expect(r.json.code).toBe('SEGREDO_NAO_CONFIGURADO'); } finally { process.env.TITULAR_HMAC_SECRET = seg; }
      delete process.env.PIX_MAX_BRL;
      const r2 = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId }); expect(r2.status).toBe(503); expect(r2.json.code).toBe('TETO_NAO_CONFIGURADO');
    });
    it('as respostas de erro de domínio só têm { error, code }: sem stack, sem causa, sem CPF/nome', async () => {
      const s = await semear({ laudo: false });
      const r = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId });
      expect(Object.keys(r.json).sort()).toEqual(['code', 'error']);
      expect(r.texto).not.toMatch(/at \S+ \(|node_modules|prisma|SELECT|52998224725/);
    });
  });

  describe('corpo ESTRITO: o servidor decide provedor, destino, valor e operador', () => {
    const extras = [{ documento: '11144477735' }, { cpf: '11144477735' }, { chavePix: 'x@y.z' }, { tipoChave: 'EMAIL' }, { valor: '999999.99' }, { provider: 'ASAAS' }, { provedor: 'SIMULADO' }, { opts: { provedor: 'SIMULADO' } }, { operador: 'fulano' }, { destino: 'outro' }];
    it.each(['confirmar-titular-laudo', 'pagar-cedente', 'reabrir-pagamento-cedente'])('%s com qualquer campo extra (documento, cpf, chavePix, valor, provider/provedor, opts, operador…) → 400 e NENHUM efeito no banco', async (action) => {
      const s = await semear();
      const base = action === 'confirmar-titular-laudo' ? { action, cessaoId: s.cessaoId, situacao: 'TITULAR_UNICO', atestado: true } : { action, cessaoId: s.cessaoId };
      const antes = await efeitos();
      for (const extra of extras) { const r = await chamar({ ...base, ...extra }); expect(r.status).toBe(400); }
      expect(await efeitos()).toEqual(antes);
    });
    it('confirmar-titular-laudo: atestado ausente/false/"true"/1 ou situação inválida → 400, nada gravado', async () => {
      const s = await semear({ laudo: true });
      for (const mau of [{ atestado: false }, { atestado: 'true' }, { atestado: 1 }, { atestado: undefined }, { situacao: 'OUTRA' }, { situacao: undefined }]) {
        const r = await chamar({ action: 'confirmar-titular-laudo', cessaoId: s.cessaoId, situacao: 'TITULAR_UNICO', atestado: true, ...mau }); expect(r.status).toBe(400);
      }
      expect((await db.cessao.findUniqueOrThrow({ where: { id: s.cessaoId } })).titularDocHmac).toBeNull();
    });
    it('cessaoId vazio, só espaços?, > 60 caracteres ou de tipo errado → 400', async () => {
      for (const id of ['', 'x'.repeat(61), 123, null, ['a']]) expect((await chamar({ action: 'pagar-cedente', cessaoId: id })).status).toBe(400);
    });
    it('o PROVEDOR vem só da configuração: PSP_PROVIDER=ASAAS (sem credencial) faz o pagar falhar fechado, sem transferência — o body não tem como trocar o provedor', async () => {
      const s = await semear(); await atestar(s.cessaoId);
      process.env.PSP_PROVIDER = 'ASAAS'; delete process.env.ASAAS_API_KEY;
      const r = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect((await efeitos()).transferencias).toBe(0);
      expect((await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId, provider: 'SIMULADO' })).status).toBe(400);
    });
  });

  describe('sessão e CSRF antes de qualquer coisa', () => {
    it('sem CSRF → a resposta do guard (403) e sem sessão → 401, nas 3 ações, sem efeito algum (nem leitura do body malformado)', async () => {
      const s = await semear();
      for (const body of [{ action: 'pagar-cedente' }, { action: 'reabrir-pagamento-cedente' }, { action: 'confirmar-titular-laudo', situacao: 'TITULAR_UNICO', atestado: true }]) {
        st.csrf = Response.json({ error: 'csrf' }, { status: 403 }); st.admin = true;
        expect((await chamar({ ...body, cessaoId: s.cessaoId })).status).toBe(403);
        st.csrf = null; st.admin = false;
        expect((await chamar({ ...body, cessaoId: s.cessaoId })).status).toBe(401);
      }
      expect(await efeitos()).toEqual({ transferencias: 0, pagamentos: 0, eventos: 0 });
    });
  });

  describe('reabrir-pagamento-cedente', () => {
    async function transferencia(s: { cessaoId: string }, status: 'FALHOU' | 'INCERTO' | 'PROCESSANDO') {
      return db.transferenciaPix.create({ data: { cessaoId: s.cessaoId, idempotencyKey: `pix-cedente:${s.cessaoId}`, provedor: 'SIMULADO', status, valor: '1500.00', destinoMascarado: 'CPF ***4725', tentativa: 1, motivoFalha: status === 'FALHOU' ? 'PSP_RECUSOU' : null } as never });
    }
    it('FALHOU confirmado → reabre com o MESMO destino: evento PIX_SIMULADO_REABERTO com operador "admin-panel", nova tentativa (:2) e COMPROVADA; INCERTO/PROCESSANDO → 409 NAO_REABRIVEL sem evento', async () => {
      const s = await semear(); await atestar(s.cessaoId); await transferencia(s, 'FALHOU');
      const r = await chamar({ action: 'reabrir-pagamento-cedente', cessaoId: s.cessaoId });
      expect(r.status).toBe(200); expect(r.json).toMatchObject({ status: 'COMPROVADA' });
      const ev = await db.eventoAudit.findFirstOrThrow({ where: { cessaoId: s.cessaoId, acao: 'PIX_SIMULADO_REABERTO' } });
      expect(ev.operador).toBe('admin-panel');
      expect((await db.transferenciaPix.findUniqueOrThrow({ where: { cessaoId: s.cessaoId } })).tentativa).toBe(2);
      for (const status of ['INCERTO', 'PROCESSANDO'] as const) {
        const o = await semear(); await atestar(o.cessaoId); await transferencia(o, status);
        const x = await chamar({ action: 'reabrir-pagamento-cedente', cessaoId: o.cessaoId });
        expect(x.status).toBe(409); expect(x.json.code).toBe('NAO_REABRIVEL');
        expect(await db.eventoAudit.count({ where: { cessaoId: o.cessaoId, acao: { in: ['PIX_REAL_REABERTO', 'PIX_SANDBOX_REABERTO', 'PIX_SIMULADO_REABERTO'] } } })).toBe(0);
      }
    });
    it('sem transferência → 404 TRANSFERENCIA_NAO_ENCONTRADA; sem laudo → 409 LAUDO_AUSENTE', async () => {
      const a = await semear(); await atestar(a.cessaoId);
      const r = await chamar({ action: 'reabrir-pagamento-cedente', cessaoId: a.cessaoId }); expect(r.status).toBe(404); expect(r.json.code).toBe('TRANSFERENCIA_NAO_ENCONTRADA');
      const b = await semear({ laudo: false }); await transferencia(b, 'FALHOU');
      const x = await chamar({ action: 'reabrir-pagamento-cedente', cessaoId: b.cessaoId }); expect(x.status).toBe(409); expect(x.json.code).toBe('LAUDO_AUSENTE');
    });
  });

  describe('fluxo da cota de prova (fix/admin-fluxo-cota-prova 0ae791a): registrar-cessao só CRIA; enviar-cessao envia só com laudo, em qualquer rede', () => {
    async function ofertaAceita() {
      seq += 1;
      const lead = await db.leadVendedor.create({ data: { nome: 'Lead D3', email: `leadof${seq}@plina.test` } });
      return db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '100000.00', administradora: 'Adm Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '1500.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
    }
    it.each(['TESTNET', 'PUBLIC'])('%s: registrar-cessao cria a cessão PENDENTE e NÃO envia (nenhum PDF, nenhum envelope); repetir devolve a mesma cessão sem 2ª', async (rede) => {
      st.rede = rede;
      const o = await ofertaAceita();
      const r1 = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r1.status).toBe(200); expect(r1.json).toMatchObject({ status: 'PENDENTE', jaEnviada: false });
      expect(st.criar).not.toHaveBeenCalled(); expect(st.pdf).not.toHaveBeenCalled();
      const r2 = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r2.json.cessaoId).toBe(r1.json.cessaoId);
      expect(await db.cessao.count({ where: { ofertaId: o.id } })).toBe(1);
      expect(st.criar).not.toHaveBeenCalled();
    });
    it.each(['TESTNET', 'PUBLIC'])('%s: enviar-cessao SEM laudo → 409 LAUDO_AUSENTE (mensagem fixa, nada enviado, cessão continua PENDENTE); registra-se o laudo; enviar-cessao envia e o PDF cita o hash do laudo (demonstracao = rede≠PUBLIC)', async (rede) => {
      st.rede = rede;
      const o = await ofertaAceita();
      const c = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      const e1 = await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId });
      expect(e1.status).toBe(409); expect(e1.json).toEqual({ error: expect.any(String), code: 'LAUDO_AUSENTE' }); expect(e1.texto).not.toMatch(/@plina\.test|Lead D3/);
      expect((await db.cessao.findUniqueOrThrow({ where: { id: c.json.cessaoId } })).status).toBe('PENDENTE');
      expect(st.criar).not.toHaveBeenCalled(); expect(st.pdf).not.toHaveBeenCalled();
      const l = await chamar({ action: 'registrar-laudo', cessaoId: c.json.cessaoId, laudoUrl: 'https://laudo.exemplo.test/l.pdf#sha256=' + 'a'.repeat(64) });
      expect(l.status).toBe(200);
      const e2 = await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId });
      expect(e2.status).toBe(200); expect(e2.json).toMatchObject({ status: 'ENVIADA_DOCUSIGN', jaEnviada: false });
      expect(st.pdf.mock.calls[0][0]).toMatchObject({ demonstracao: rede !== 'PUBLIC', hashLaudo: l.json.hashValidacao });
      const e3 = await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId });
      expect(e3.json).toMatchObject({ jaEnviada: true }); expect(st.criar).toHaveBeenCalledTimes(1);
    });
    it('enviar-cessao: corpo estrito (campo extra → 400), cessão inexistente → erro sem efeito, sem sessão → 401, sem CSRF → recusa', async () => {
      const o = await ofertaAceita();
      const c = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      const extra = await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId, operador: 'x' });
      expect(extra.status).toBe(400);
      const nao = await chamar({ action: 'enviar-cessao', cessaoId: 'nao_existe' });
      expect(nao.status).toBeGreaterThanOrEqual(400); expect(st.criar).not.toHaveBeenCalled();
      st.admin = false;
      expect((await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId })).status).toBe(401);
      st.admin = true; st.csrf = new Response(null, { status: 403 });
      expect((await chamar({ action: 'enviar-cessao', cessaoId: c.json.cessaoId })).status).toBe(403);
      expect(st.criar).not.toHaveBeenCalled();
    });
    it('oferta que não está ACEITA → registrar-cessao falha sem criar cessão', async () => {
      const o = await ofertaAceita();
      await db.oferta.update({ where: { id: o.id }, data: { status: 'RASCUNHO' as never } });
      const r = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await db.cessao.count()).toBe(0);
    });
  });

  describe('incorporar-cota do funil exige cessão ASSINADA + Pix COMPROVADO (em qualquer rede)', () => {
    async function comPagamento(o: { cessao: 'ASSINADA' | 'ENVIADA_DOCUSIGN'; pix: 'COMPROVADA' | 'FALHOU' | null }) {
      const s = await semear({ status: o.cessao as never });
      await db.pagamento.create({ data: { cessaoId: s.cessaoId, metodo: 'PIX_SIMULADO', valor: '1500.00', status: 'EXECUTADO', executadoEm: new Date() } as never });
      if (o.pix) await db.transferenciaPix.create({ data: { cessaoId: s.cessaoId, idempotencyKey: `pix-cedente:${s.cessaoId}`, provedor: 'SIMULADO', status: o.pix, valor: '1500.00', destinoMascarado: 'CPF ***4725' } });
      return s;
    }
    it.each(['TESTNET', 'PUBLIC'])('%s: cessão NÃO assinada (com Pagamento EXECUTADO forjado) → 409 CESSAO_NAO_ASSINADA, nada emitido', async (rede) => {
      st.rede = rede;
      const s = await comPagamento({ cessao: 'ENVIADA_DOCUSIGN', pix: 'COMPROVADA' });
      const r = await chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId });
      expect(r.status).toBe(409); expect(r.json.code).toBe('CESSAO_NAO_ASSINADA');
      expect(st.incorporar).not.toHaveBeenCalled();
    });
    it.each(['TESTNET', 'PUBLIC'])('%s: Pagamento EXECUTADO sem TransferenciaPix (o Pix legado) → 409 PIX_NAO_COMPROVADO; Pix FALHOU também; nada emitido', async (rede) => {
      st.rede = rede;
      const a = await comPagamento({ cessao: 'ASSINADA', pix: null });
      const ra = await chamar({ action: 'incorporar-cota', cessaoId: a.cessaoId });
      expect(ra.status).toBe(409); expect(ra.json.code).toBe('PIX_NAO_COMPROVADO');
      const b = await comPagamento({ cessao: 'ASSINADA', pix: 'FALHOU' });
      const rb = await chamar({ action: 'incorporar-cota', cessaoId: b.cessaoId });
      expect(rb.status).toBe(409); expect(rb.json.code).toBe('PIX_NAO_COMPROVADO');
      expect(st.incorporar).not.toHaveBeenCalled();
      expect(await db.leadVendedor.count({ where: { status: 'COTA_INCORPORADA' } })).toBe(0);
    });
    it('cessão ASSINADA + Pix COMPROVADO → passa pelos gates e chama a incorporação UMA vez com o laudo registrado da cessão (a emissão em si é do E1-P)', async () => {
      const s = await comPagamento({ cessao: 'ASSINADA', pix: 'COMPROVADA' });
      const r = await chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId });
      expect(st.incorporar).toHaveBeenCalledTimes(1);
      expect(st.incorporar.mock.calls[0][0]).toMatchObject({ cessaoId: s.cessaoId, operador: 'admin-panel' });
      expect(st.incorporar.mock.calls[0][0].hashValidacao).toMatch(/^[0-9a-f]{64}$/);
      expect(r.status).toBe(200);
    });
    it('e659d62: sem Pagamento EXECUTADO → 409 PAGAMENTO_NAO_EXECUTADO (tipado, mensagem fixa), nada emitido', async () => {
      const s = await semear({ status: 'ASSINADA' });
      const r = await chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId });
      expect(r.status).toBe(409); expect(r.json).toEqual({ error: expect.any(String), code: 'PAGAMENTO_NAO_EXECUTADO' });
      expect(st.incorporar).not.toHaveBeenCalled();
    });
    async function cotaExistente(cessaoId: string) {
      const c = await db.cota.create({ data: { id: `inc_${cessaoId}`, tipoBem: 'IMOVEL', administradora: 'Adm Ficticia', valorCarta: '100000.00', desagioAquisicao: '0.2000', desagioRevenda: '0.1000', status: 'DISPONIVEL', tokensEmitidos: '1200.0000000', emissaoTxHash: 'f'.repeat(64), cessaoId } as never });
      await db.eventoAudit.create({ data: { acao: 'COTA_INCORPORADA', operador: 'admin-panel', cotaId: c.id, stellarTxHash: c.emissaoTxHash, payloadJson: {} } as never });
      return c;
    }
    it('RETOMADA (runbook "chame de novo"): a Cota já existe mas o lead não foi marcado ⇒ NÃO emite de novo, completa o vínculo (lead COTA_INCORPORADA, audit ligado ao lead e à cessão) e devolve a Cota; a chamada seguinte ⇒ 409 COTA_JA_INCORPORADA', async () => {
      const s = await comPagamento({ cessao: 'ASSINADA', pix: 'COMPROVADA' });
      const c = await cotaExistente(s.cessaoId);
      const r = await chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId });
      expect(r.status).toBe(200); expect(r.json).toMatchObject({ cotaId: c.id, txHash: 'f'.repeat(64) });
      expect(st.incorporar).not.toHaveBeenCalled();
      expect((await db.leadVendedor.findUniqueOrThrow({ where: { id: s.leadId } })).status).toBe('COTA_INCORPORADA');
      const ev = await db.eventoAudit.findFirstOrThrow({ where: { cotaId: c.id, acao: 'COTA_INCORPORADA' } });
      expect(ev).toMatchObject({ leadVendedorId: s.leadId, cessaoId: s.cessaoId });
      const de_novo = await chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId });
      expect(de_novo.status).toBe(409); expect(de_novo.json.code).toBe('COTA_JA_INCORPORADA');
      expect(st.incorporar).not.toHaveBeenCalled();
      expect(await db.cota.count()).toBe(1);
    });
    it('a retomada TAMBÉM exige cessão ASSINADA + Pix COMPROVADO (Cota existente não contorna o gate)', async () => {
      const a = await comPagamento({ cessao: 'ENVIADA_DOCUSIGN', pix: 'COMPROVADA' }); await cotaExistente(a.cessaoId);
      expect((await chamar({ action: 'incorporar-cota', cessaoId: a.cessaoId })).json.code).toBe('CESSAO_NAO_ASSINADA');
      const b = await comPagamento({ cessao: 'ASSINADA', pix: 'FALHOU' }); await cotaExistente(b.cessaoId);
      expect((await chamar({ action: 'incorporar-cota', cessaoId: b.cessaoId })).json.code).toBe('PIX_NAO_COMPROVADO');
      expect(await db.leadVendedor.count({ where: { status: 'COTA_INCORPORADA' } })).toBe(0);
    });
    it('3 chamadas SIMULTÂNEAS na retomada: nenhuma emite, a Cota continua UMA e o audit COTA_INCORPORADA continua UM (vínculo idempotente); as perdedoras recebem 200 ou 409 COTA_JA_INCORPORADA, nunca 500', async () => {
      const s = await comPagamento({ cessao: 'ASSINADA', pix: 'COMPROVADA' });
      const c = await cotaExistente(s.cessaoId);
      const rs = await Promise.all(Array.from({ length: 3 }, () => chamar({ action: 'incorporar-cota', cessaoId: s.cessaoId })));
      expect(rs.filter((r) => r.status === 500)).toHaveLength(0);
      expect(rs.every((r) => r.status === 200 || r.json.code === 'COTA_JA_INCORPORADA')).toBe(true);
      expect(st.incorporar).not.toHaveBeenCalled();
      expect(await db.eventoAudit.count({ where: { cotaId: c.id, acao: 'COTA_INCORPORADA' } })).toBe(1);
    });
  });

  describe('mainnet (STELLAR_NETWORK=PUBLIC): nada paga', () => {
    it('pagar-cedente em PUBLIC falha fechado (nenhuma transferência/pagamento); caracterização: o código devolvido', async () => {
      const s = await semear(); await atestar(s.cessaoId);
      st.rede = 'PUBLIC'; process.env.STELLAR_NETWORK = 'PUBLIC';
      try {
        const r = await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId });
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect((await efeitos()).transferencias).toBe(0); expect(await db.pagamento.count()).toBe(0);
        // INFO: a recusa vem de PspError(PSP_CONFIG) (não é erro de domínio mapeado): hoje cai no 500 genérico em vez de 503/409
        expect(r.status).toBe(500);
      } finally { delete process.env.STELLAR_NETWORK; }
    });
  });

  describe('executar-pix-simulado SAIU da rota admin (fecha F-D3-1)', () => {
    it.each(['TESTNET', 'PUBLIC'])('%s: a action não existe mais (400, corpo estrito) e nada é marcado — nem sem laudo/atestado/KYC', async (rede) => {
      st.rede = rede;
      const s = await semear({ laudo: false, kyc: false });
      const r = await chamar({ action: 'executar-pix-simulado', cessaoId: s.cessaoId });
      expect(r.status).toBe(400);
      expect(await db.pagamento.count()).toBe(0);
      expect(await db.eventoAudit.count({ where: { acao: 'PIX_SIMULADO_EXECUTADO' } })).toBe(0);
    });
    it('o único pagamento pela rota é pagar-cedente: sem laudo/atestado ele recusa (409) e com eles paga com os controles do E1-2', async () => {
      const s = await semear({ laudo: false, kyc: false });
      expect((await chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId })).status).toBe(409);
      expect(await db.pagamento.count()).toBe(0);
    });
  });

  it('5 pagar-cedente SIMULTÂNEOS pela rota: UM pagamento e uma transferência COMPROVADA (as outras recebem 200 do estado ou 409), sem 500', async () => {
    const s = await semear(); await atestar(s.cessaoId);
    const rs = await Promise.all(Array.from({ length: 5 }, () => chamar({ action: 'pagar-cedente', cessaoId: s.cessaoId })));
    expect(rs.filter((r) => r.status === 500)).toHaveLength(0);
    expect(await db.pagamento.count({ where: { cessaoId: s.cessaoId } })).toBe(1);
    expect(await db.transferenciaPix.count({ where: { cessaoId: s.cessaoId } })).toBe(1);
  });
});
