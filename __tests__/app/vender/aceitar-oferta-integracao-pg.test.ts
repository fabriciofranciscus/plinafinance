// @vitest-environment jsdom
/**
 * QA Vera — hotfix 2: componente REAL (AcompanharView) → rota REAL (/api/vender/aceitar-oferta, withPessoaAuth) → serviço REAL
 * (aceitarOferta) → Postgres REAL. Só o verificador do token do Privy e a âncora on-chain são simulados.
 * Opt-in: TEST_PG_URL local descartável (os `*-pg` se recusam a rodar contra host não-local).
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PG = vi.hoisted(() => {
  const url = process.env.TEST_PG_URL;
  if (url) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('TEST_PG_URL deve apontar para um Postgres local descartável.');
    process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
  }
  return url;
});
const st = vi.hoisted(() => ({ ip: '203.0.113.1', refresh: vi.fn(), token: null as string | null, quem: {} as Record<string, string> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: st.refresh, push: vi.fn() }) }));
vi.mock('@/lib/hooks/privy', () => ({ useAppPrivy: () => ({ getAccessToken: async () => st.token }) }));
vi.mock('@/lib/wallet/privy', () => ({
  verifyPrivyTokenLite: async (t: string) => {
    if (!st.quem[t]) throw new Error('invalido');
    return { userId: st.quem[t], email: 'x@exemplo.test' };
  },
}));
vi.mock('@/lib/stellar/audit', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/audit')>()), registerOnChainHash: async () => ({ payloadHash: 'a'.repeat(64), txHash: 'b'.repeat(64) }) }));

import { db } from '@/lib/db';
import { POST } from '@/app/api/vender/aceitar-oferta/route';
import AcompanharView, { type AcompanharData } from '@/components/vender/AcompanharView';

const LIMPAR = 'TRUNCATE "EventoAudit","Cessao","Oferta","LeadVendedor","Pessoa" RESTART IDENTITY CASCADE';
let seq = 0;
async function semear(o: { kyc?: boolean; dono?: boolean; status?: 'ENVIADA' | 'ACEITA'; validade?: Date } = {}) {
  seq += 1;
  const dono = await db.pessoa.create({ data: { privyId: `did:privy:dono${seq}`, email: `dono${seq}@exemplo.test`, nome: 'Dono Ficticio', publicKey: `GAC${seq}`.padEnd(56, 'A'), kycAprovado: o.kyc ?? true } as never });
  const outro = await db.pessoa.create({ data: { privyId: `did:privy:outro${seq}`, email: `outro${seq}@exemplo.test`, nome: 'Outro Ficticio', publicKey: `GAD${seq}`.padEnd(56, 'A'), kycAprovado: true } as never });
  const lead = await db.leadVendedor.create({ data: { nome: 'Dono Ficticio', email: `lead${seq}@exemplo.test`, pessoaId: dono.id, status: 'OFERTA_ENVIADA' as never } });
  const oferta = await db.oferta.create({ data: { leadVendedorId: lead.id, tipoBem: 'IMOVEL', valorCarta: '50000.00', administradora: 'Adm Ficticia', desagioAquisicao: '0.2000', valorLiquidoVendedor: '40000.00', validade: o.validade ?? new Date(Date.now() + 86_400_000), status: (o.status ?? 'ENVIADA') as never } });
  st.quem = { 'tok-dono': dono.privyId, 'tok-outro': outro.privyId };
  const data: AcompanharData = { leadId: lead.id, cedenteNome: 'Dono Ficticio', status: 'OFERTA_ENVIADA', etapaAtual: 3, contextoDescricao: 'Oferta enviada.', ofertaId: oferta.id,
    oferta: { valorCarta: 50000, desagioPct: '20.00', valorLiquido: 40000, prazoRestanteMeses: 18, validade: '2026-12-01' }, cessaoId: null, consentTx: null, cessaoTx: null, pixTx: null, temCota: false };
  return { oferta, lead, data };
}
const estado = async (id: string) => (await db.oferta.findUniqueOrThrow({ where: { id } })).status;
const aceitar = () => fireEvent.click(screen.getByRole('button', { name: /Aceitar proposta/ }));

describe.skipIf(!PG)('hotfix 2 — aceitar oferta pelo /vender/acompanhar (componente → rota → serviço → Postgres)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterAll(async () => { await db.$disconnect(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    st.refresh.mockClear(); st.token = null;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // o fetch do componente vai para o handler REAL, com o MESMO Request que o navegador montaria
    // um IP por teste: o leadLimiter REAL (5/min por IP) não pode contaminar um teste com o seguinte
    st.ip = `203.0.113.${(seq % 250) + 1}`;
    fetchMock = vi.fn(async (url: string, init: RequestInit) => POST(new Request(`http://x${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': st.ip } })));
    vi.stubGlobal('fetch', fetchMock);
    await db.$executeRawUnsafe(LIMPAR);
  });

  it('com sessão do dono: o header chega à rota, a oferta vira ACEITA no banco e a tela se atualiza (era o 401 que bloqueava a cota)', async () => {
    const s = await semear(); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    await waitFor(() => expect(st.refresh).toHaveBeenCalled());
    expect(await estado(s.oferta.id)).toBe('ACEITA');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-dono');
  });

  it('sem sessão (token nulo): 401 "token Privy ausente" na tela, oferta INALTERADA, sem refresh (o 401 de antes agora só ocorre sem login)', async () => {
    const s = await semear(); st.token = null;
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText('token Privy ausente')).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('ENVIADA');
    expect(st.refresh).not.toHaveBeenCalled();
  });

  it('token inválido ⇒ 401 "token Privy inválido"; oferta inalterada', async () => {
    const s = await semear(); st.token = 'tok-falso';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText('token Privy inválido')).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('ENVIADA');
  });

  it('OWNERSHIP: o token de OUTRA pessoa (com KYC) aceitando a oferta alheia ⇒ 403 "não pertence"; oferta inalterada', async () => {
    const s = await semear(); st.token = 'tok-outro';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText(/não pertence/)).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('ENVIADA');
  });

  it('sem KYC aprovado ⇒ 403 "KYC pendente"; oferta inalterada', async () => {
    const s = await semear({ kyc: false }); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText(/KYC pendente/)).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('ENVIADA');
  });

  it('oferta já ACEITA (2º clique / reload): 409 "não aceitável" na tela, estado intacto, nenhuma 2ª âncora', async () => {
    const s = await semear({ status: 'ACEITA' }); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText(/não aceitável/)).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('ACEITA');
  });

  it('oferta expirada ⇒ 409 "expirada" e vira EXPIRADA no banco', async () => {
    const s = await semear({ validade: new Date(Date.now() - 60_000) }); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    expect(await screen.findByText(/expirada/)).toBeTruthy();
    expect(await estado(s.oferta.id)).toBe('EXPIRADA');
  });

  it('duplo clique rápido: 1 só aceite efetivo e 1 só requisição (o botão desabilita ao 1º clique); nunca 500', async () => {
    const s = await semear(); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    const b = screen.getByRole('button', { name: /Aceitar proposta/ });
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(st.refresh).toHaveBeenCalled(), { timeout: 8000 });
    expect(await estado(s.oferta.id)).toBe('ACEITA');
    for (const r of await Promise.all(fetchMock.mock.results.map((x) => x.value as Promise<Response>))) expect(r.status).not.toBe(500);
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(await db.eventoAudit.count({ where: { acao: 'OFERTA_ACEITA' as never } })).toBeLessThanOrEqual(1);
  });

  it('o corpo é estrito e só leva o ofertaId (nada de pessoaId/papel vindo do cliente)', async () => {
    const s = await semear(); st.token = 'tok-dono';
    render(createElement(AcompanharView, { data: s.data }));
    aceitar();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ ofertaId: s.oferta.id });
  });

  it('rate limit real: a 6ª tentativa do mesmo IP no minuto ⇒ 429 "too many requests" na tela, oferta inalterada (o hotfix não abre brecha no limiter)', async () => {
    const s = await semear({ status: 'ACEITA' }); st.token = 'tok-dono';
    st.ip = '198.51.100.77';
    const chamar = () => POST(new Request('http://x/api/vender/aceitar-oferta', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-dono', 'x-forwarded-for': st.ip }, body: JSON.stringify({ ofertaId: s.oferta.id }) }));
    const codigos: number[] = [];
    for (let i = 0; i < 7; i++) codigos.push((await chamar()).status);
    expect(codigos.slice(0, 5).every((c) => c === 409)).toBe(true); // oferta já aceita
    expect(codigos.slice(5)).toEqual([429, 429]);
  });
});
