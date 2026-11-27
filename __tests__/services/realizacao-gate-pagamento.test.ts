/**
 * Gate de pagamento no servidor, fase 1 (pendência ALTA pré-mainnet do Argus, 27/11). Não existe prova do pagamento do comprador no
 * sistema: o atesto é só tela. Realizar a cota grava o valor no razão e sobe o NAV. Por isso, fora da TESTNET a realização é
 * recusada no SERVIÇO (cobre /api/admin/realizacao, /api/comprar/confirmar e qualquer outro chamador), antes de ler o banco, de
 * ancorar na rede e de gravar. Na TESTNET (pagamento simulado) nada muda. Lista de permissão: só o valor exato 'TESTNET' libera.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  rede: 'TESTNET' as string,
  findUnique: vi.fn(), tx: vi.fn(), ancora: vi.fn(),
  admin: vi.fn(), csrf: vi.fn(), flag: vi.fn(), consume: vi.fn(),
}));

vi.mock('@/lib/stellar/config', async (orig) => {
  const mod = { ...(await orig<typeof import('@/lib/stellar/config')>()) } as Record<string, unknown>;
  Object.defineProperty(mod, 'STELLAR_NETWORK', { get: () => m.rede, enumerable: true });
  return mod;
});
vi.mock('@/lib/db', () => ({ db: { reserva: { findUnique: m.findUnique }, $transaction: m.tx } }));
vi.mock('@/lib/stellar/audit', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/audit')>()), registerOnChainHash: m.ancora }));
vi.mock('@/lib/auth/admin', () => ({ isAdminAuthenticated: m.admin }));
vi.mock('@/lib/auth/admin-csrf', () => ({ requireAdminCsrf: m.csrf }));
vi.mock('@/lib/env/flags', () => ({ getFlag: m.flag }));
vi.mock('@/lib/rate-limit/config', () => ({ sensitiveAuthLimiter: { consume: m.consume }, clientIp: () => 'ip' }));
vi.mock('@/lib/wallet/pessoa-auth', () => ({
  withPessoaAuth: (h: (req: Request, ctx: unknown) => Promise<Response>) => (req: Request) => h(req, { user: { pessoaId: 'p1', kycAprovado: true } }),
}));

import { RealizacaoBloqueadaError, executarCaminhoA } from '@/lib/services/realizacao';
import { POST as ADMIN } from '@/app/api/admin/realizacao/route';
import { POST as CONFIRMAR } from '@/app/api/comprar/confirmar/route';

const reserva = () => ({
  id: 'r1', status: 'ATIVA', cotaId: 'c1', leadCompradorId: 'l1', expiraEm: new Date(Date.now() + 3_600_000),
  cota: { id: 'c1', status: 'RESERVADA', valorCarta: '100000', desagioAquisicao: '0.2', desagioRevenda: '0.1' },
  leadComprador: { id: 'l1', pessoaId: 'p1' }, cessaoComprador: { status: 'ASSINADA' },
});
const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const semEfeito = () => { expect(m.ancora).not.toHaveBeenCalled(); expect(m.tx).not.toHaveBeenCalled(); };
const ENTRADA = { reservaId: 'r1', valorRealizado: '90000', operador: 'admin-panel' };
const FORA_DA_TESTNET = ['PUBLIC', 'public', 'FUTURENET', 'testnet', ' TESTNET', ''];

beforeEach(() => {
  m.rede = 'TESTNET';
  for (const f of [m.findUnique, m.tx, m.ancora, m.admin, m.csrf, m.flag, m.consume]) f.mockReset();
  m.findUnique.mockResolvedValue(reserva());
  m.ancora.mockResolvedValue({ txHash: 'tx', payloadHash: 'h' });
  m.tx.mockResolvedValue({ id: 'real_1' });
  m.admin.mockResolvedValue(true); m.csrf.mockReturnValue(null); m.consume.mockResolvedValue(true); m.flag.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('serviço: executarCaminhoA', () => {
  it.each(FORA_DA_TESTNET)('rede %j: recusa com PAGAMENTO_NAO_COMPROVADO, sem ler o banco, sem âncora e sem gravar', async (rede) => {
    m.rede = rede;
    const e = await executarCaminhoA(ENTRADA).catch((x) => x);
    expect(e).toBeInstanceOf(RealizacaoBloqueadaError);
    expect(e.code).toBe('PAGAMENTO_NAO_COMPROVADO');
    expect(m.findUnique).not.toHaveBeenCalled();
    semEfeito();
  });
  it('a mensagem é fixa: não cita id, valor nem nome de variável', async () => {
    m.rede = 'PUBLIC';
    const e = await executarCaminhoA({ ...ENTRADA, reservaId: 'r-secreto', valorRealizado: '12345.67' }).catch((x) => x);
    expect(e.message).not.toMatch(/r-secreto|12345|STELLAR_|BUYER_/);
  });
  it('TESTNET: segue como antes (ancora e grava)', async () => {
    await expect(executarCaminhoA(ENTRADA)).resolves.toMatchObject({ realizacaoId: 'real_1' });
    expect(m.ancora).toHaveBeenCalledTimes(1);
    expect(m.tx).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/realizacao', () => {
  const executar = () => ADMIN(post('/api/admin/realizacao', { action: 'executar-caminho-a', reservaId: 'r1', valorRealizado: '90000' }));
  it('rede principal: 409 com code e mensagem fixa, sem efeito (sessão admin não basta)', async () => {
    m.rede = 'PUBLIC';
    const r = await executar();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: new RealizacaoBloqueadaError().message, code: 'PAGAMENTO_NAO_COMPROVADO' });
    semEfeito();
  });
  it('TESTNET: executa', async () => {
    expect((await executar()).status).toBe(200);
    expect(m.tx).toHaveBeenCalledTimes(1);
  });
  it('sem sessão continua 401 (o gate não substitui a autenticação)', async () => {
    m.rede = 'PUBLIC'; m.admin.mockResolvedValue(false);
    expect((await executar()).status).toBe(401);
  });
});

describe('POST /api/comprar/confirmar', () => {
  const confirmar = () => CONFIRMAR(post('/api/comprar/confirmar', { reservaId: 'r1' }));
  it('rede principal com a flag LIGADA: fica pendente de confirmação, como com a flag desligada, sem efeito', async () => {
    m.rede = 'PUBLIC';
    const r = await confirmar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'PENDENTE_CONFIRMACAO', valorRealizado: '90000.00' });
    semEfeito();
  });
  it('TESTNET com a flag ligada: realiza como antes', async () => {
    const r = await confirmar();
    const corpo = await r.json();
    expect([r.status, corpo]).toEqual([200, expect.objectContaining({ status: 'REALIZADA' })]);
    expect(m.tx).toHaveBeenCalledTimes(1);
  });
  it('TESTNET com a flag desligada: pendente, como antes', async () => {
    m.flag.mockResolvedValue(false);
    expect((await (await confirmar()).json()).status).toBe('PENDENTE_CONFIRMACAO');
    semEfeito();
  });
});
