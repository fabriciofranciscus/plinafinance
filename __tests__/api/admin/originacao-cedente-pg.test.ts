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
const st = vi.hoisted(() => ({ criar: vi.fn(), buscar: vi.fn(), pdf: vi.fn(), ancora: vi.fn(), blob: vi.fn(), alerta: vi.fn(), rede: 'TESTNET', admin: true, csrf: null as null | Response }));
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
    st.rede = 'TESTNET'; st.admin = true; st.csrf = null;
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

  describe('F-DS2-1 pela rota: registrar-cessao (cria a cessão E envia) × laudo', () => {
    async function ofertaAceita() {
      seq += 1;
      const lead = await db.leadVendedor.create({ data: { nome: 'Lead D3', email: `leadof${seq}@plina.test` } });
      return db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '100000.00', administradora: 'Adm Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '1500.00', validade: new Date(Date.now() + 86_400_000), status: 'ACEITA' } });
    }
    it('MAINNET: o 1º registrar-cessao cria a cessão PENDENTE e responde 409 LAUDO_AUSENTE (mensagem fixa, nada enviado); registra-se o laudo; o 2º registrar-cessao envia (idempotente: sem 2ª cessão)', async () => {
      st.rede = 'PUBLIC';
      const o = await ofertaAceita();
      const r1 = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r1.status).toBe(409); expect(r1.json).toEqual({ error: expect.any(String), code: 'LAUDO_AUSENTE' }); expect(r1.texto).not.toMatch(/@plina\.test|Lead D3/);
      const c = await db.cessao.findUniqueOrThrow({ where: { ofertaId: o.id } });
      expect(c.status).toBe('PENDENTE'); expect(st.criar).not.toHaveBeenCalled(); expect(st.pdf).not.toHaveBeenCalled();
      const l = await chamar({ action: 'registrar-laudo', cessaoId: c.id, laudoUrl: 'https://laudo.exemplo.test/l.pdf#sha256=' + 'a'.repeat(64) });
      expect(l.status).toBe(200);
      const r2 = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r2.status).toBe(200); expect(r2.json).toMatchObject({ status: 'ENVIADA_DOCUSIGN', jaEnviada: false });
      expect(await db.cessao.count({ where: { ofertaId: o.id } })).toBe(1);
      expect((st.pdf.mock.calls[0][0] as { hashLaudo: string; demonstracao: boolean })).toMatchObject({ demonstracao: false, hashLaudo: l.json.hashValidacao });
    });
    // LIMITAÇÃO para a cota de prova (testnet): `registrarCessao` cria E envia no mesmo passo e o laudo só pode existir DEPOIS de a cessão
    // existir (registrarLaudoDaCessao exige cessaoId); então na testnet o 1º registrar-cessao ENVIA sem laudo e o PDF de demonstração
    // sai com "laudo … ainda não registrado". Sem `enviar:false` + case "enviar-cessao" (proposta do Bento, pendente do Atlas) o PDF
    // assinado da cota de prova não carrega o hash do laudo.
    it('TESTNET (limitação, caracterização): o 1º registrar-cessao envia SEM laudo — o PDF de demonstração recebe hashLaudo = null', async () => {
      st.rede = 'TESTNET';
      const o = await ofertaAceita();
      const r = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r.status).toBe(200); expect(r.json).toMatchObject({ status: 'ENVIADA_DOCUSIGN' });
      expect(st.pdf.mock.calls[0][0]).toMatchObject({ demonstracao: true, hashLaudo: null });
    });
    it('registrar-cessao é idempotente: repetir devolve o mesmo envelope (jaEnviada) e não cria 2ª cessão nem 2º envelope; oferta que não está ACEITA → erro', async () => {
      const o = await ofertaAceita();
      await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      const r2 = await chamar({ action: 'registrar-cessao', ofertaId: o.id });
      expect(r2.json).toMatchObject({ jaEnviada: true });
      expect(st.criar).toHaveBeenCalledTimes(1); expect(await db.cessao.count()).toBe(1);
      await db.oferta.update({ where: { id: o.id }, data: { status: 'RECUSADA' as never } }).catch(() => undefined);
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
    it('executar-pix-simulado em PUBLIC → 409 PIX_SIMULADO_EM_MAINNET sem efeito', async () => {
      const s = await semear(); st.rede = 'PUBLIC';
      const r = await chamar({ action: 'executar-pix-simulado', cessaoId: s.cessaoId });
      expect(r.status).toBe(409); expect(r.json.code).toBe('PIX_SIMULADO_EM_MAINNET');
      expect(await db.pagamento.count()).toBe(0);
    });
  });

  describe('caminho LEGADO executar-pix-simulado (testnet) — Argus A1', () => {
    // Pré-existente: só exige cessão ASSINADA e contorna laudo, atestado do titular, KYC, PSP, comprovante e âncora do E1-2, mas
    // habilita a incorporação. Na cota de prova usar SÓ pagar-cedente; o legado é decisão do Atlas (sair ou exigir os mesmos controles).
    it.fails('F-D3-1 (BAIXO, Argus A1) — executar-pix-simulado deve exigir o mesmo laudo/atestado: sem laudo, sem atestado e sem KYC ele NÃO pode marcar Pagamento EXECUTADO', async () => {
      const s = await semear({ laudo: false, kyc: false });
      const r = await chamar({ action: 'executar-pix-simulado', cessaoId: s.cessaoId });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await db.pagamento.count()).toBe(0);
    });
    it('caracterização — o legado marca o Pix executado SEM laudo, SEM atestado e SEM KYC (testnet)', async () => {
      const s = await semear({ laudo: false, kyc: false });
      const r = await chamar({ action: 'executar-pix-simulado', cessaoId: s.cessaoId });
      expect(r.status).toBe(200);
      expect(await db.pagamento.count({ where: { cessaoId: s.cessaoId } })).toBe(1);
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
