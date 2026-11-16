/**
 * U1-11 (Atlas; Argus com veto): o clawback é idempotente por PEDIDO no servidor. O 2º envio do mesmo pedido devolve o resultado do 1º
 * SEM 2ª execução on-chain; erro fixo (sem nome de variável, sem err.message). Banco simulado com estado; Stellar simulado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  executeClawback: vi.fn(), registerOnChainHash: vi.fn(), decrementar: vi.fn(),
  eventos: [] as Array<Record<string, any>>, investidor: { id: 'inv_1', publicKey: 'GABC', saldoEsperado: '1000' } as Record<string, any> | null,
  seq: 0,
}));
vi.mock('@/lib/stellar/signer', () => ({ issuerSigner: () => ({}) }));
vi.mock('@/lib/stellar/audit', () => ({ buildAuditPayload: (_t: string, _i: string, x: object) => x, registerOnChainHash: m.registerOnChainHash }));
vi.mock('@/lib/services/holdings', () => ({ decrementarHolding: m.decrementar }));
vi.mock('@/lib/stellar/issuer', async (orig) => ({ ...(await orig<typeof import('@/lib/stellar/issuer')>()), executeClawback: m.executeClawback }));
vi.mock('@/lib/db', () => {
  const casa = (e: Record<string, any>, where: Record<string, any>) => {
    if (where.acao && e.acao !== where.acao) return false;
    if (where.id && e.id !== where.id) return false;
    const pj = where.payloadJson;
    if (pj?.path) return e.payloadJson?.[pj.path[0]] === pj.equals;
    return true;
  };
  const ev = {
    findFirst: async ({ where }: { where: Record<string, any> }) => m.eventos.find((e) => casa(e, where)) ?? null,
    create: async ({ data }: { data: Record<string, any> }) => { const e = { id: `ev_${++m.seq}`, ...data }; m.eventos.push(e); return e; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => { const e = m.eventos.find((x) => x.id === where.id)!; Object.assign(e, data); return e; },
  };
  const tx = {
    $executeRaw: async () => 1, eventoAudit: ev,
    investidor: { update: async () => ({}) },
  };
  return { db: { ...tx, investidor: { findUnique: async () => m.investidor, update: async () => ({}) }, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});

import { ClawbackError, executarClawback } from '@/lib/services/tokenizacao';

const IN = { investidorId: 'inv_1', amount: '100', motivo: 'ERRO_OPERACIONAL' as never, fundamentoUrl: 'https://x.test/decisao.pdf', operador: 'admin-panel', pedidoId: 'pedido-0123456789abcdef' };

beforeEach(() => {
  m.eventos.length = 0; m.seq = 0;
  m.investidor = { id: 'inv_1', publicKey: 'GABC', saldoEsperado: '1000' };
  for (const f of [m.executeClawback, m.registerOnChainHash, m.decrementar]) f.mockReset();
  m.executeClawback.mockResolvedValue({ hash: 'tx_claw_1' });
  m.registerOnChainHash.mockResolvedValue({ txHash: 'tx_memo_1', payloadHash: 'hash_1' });
  m.decrementar.mockResolvedValue(undefined);
  process.env.STELLAR_ISSUER_SECRET = 'SXXXX';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('idempotência por pedido', () => {
  it('1ª chamada executa UMA vez; a 2ª com o MESMO pedido devolve o resultado do 1º, idempotente, sem 2ª execução on-chain', async () => {
    const a = await executarClawback(IN);
    const b = await executarClawback(IN);
    expect(a).toMatchObject({ txHash: 'tx_claw_1', fundamentoTxHash: 'tx_memo_1', payloadHash: 'hash_1' });
    expect(b).toMatchObject({ txHash: 'tx_claw_1', fundamentoTxHash: 'tx_memo_1', payloadHash: 'hash_1', idempotente: true });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
    expect(m.registerOnChainHash).toHaveBeenCalledTimes(1);
    expect(m.decrementar).toHaveBeenCalledTimes(1);
    expect(m.eventos.filter((e) => e.acao === 'CLAWBACK_EXECUTADO')).toHaveLength(1);
  });

  it('pedidos DIFERENTES executam cada um (a chave é por pedido, não por conteúdo)', async () => {
    await executarClawback(IN);
    await executarClawback({ ...IN, pedidoId: 'pedido-outro-9876543210' });
    expect(m.executeClawback).toHaveBeenCalledTimes(2);
  });

  it('mesmo pedido com outro valor ou outro alvo → PEDIDO_INVALIDO, sem executar', async () => {
    await executarClawback(IN);
    await expect(executarClawback({ ...IN, amount: '999' })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    await expect(executarClawback({ ...IN, investidorId: 'inv_2' })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
  });

  it('pedido já TENTADO e sem conclusão (attempting) → PEDIDO_EM_ANDAMENTO fixo, nunca uma 2ª execução', async () => {
    m.eventos.push({ id: 'ev_x', acao: 'CLAWBACK_EXECUTADO', investidorId: 'inv_1', payloadJson: { pedidoId: IN.pedidoId, amount: '100', status: 'attempting' } });
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'PEDIDO_EM_ANDAMENTO' });
    expect(m.executeClawback).not.toHaveBeenCalled();
  });

  it('falha on-chain: marca o pedido como falhou, erro fixo EXECUCAO_FALHOU e o mesmo pedido NÃO reexecuta (PEDIDO_FALHOU)', async () => {
    m.executeClawback.mockRejectedValueOnce(new Error('horizon: segredo xyz e ana@exemplo.test'));
    const e1 = await executarClawback(IN).catch((e) => e);
    expect(e1).toBeInstanceOf(ClawbackError);
    expect(e1.code).toBe('EXECUCAO_FALHOU');
    expect(e1.message).not.toMatch(/xyz|exemplo\.test|horizon/);
    expect(m.eventos[0]!.payloadJson.status).toBe('failed');
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'PEDIDO_FALHOU' });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
  });

  it('o clawback já foi à rede mas o registro falhou (memo): erro REGISTRO_PENDENTE com o txHash; o MESMO pedido RETOMA sem reexecutar o clawback nem decrementar duas vezes', async () => {
    m.registerOnChainHash.mockRejectedValueOnce(new Error('memo caiu'));
    const e1 = await executarClawback(IN).catch((e) => e);
    expect(e1.code).toBe('REGISTRO_PENDENTE');
    expect(e1.txHash).toBe('tx_claw_1');
    expect(m.decrementar).not.toHaveBeenCalled();
    const r = await executarClawback(IN);
    expect(r).toMatchObject({ txHash: 'tx_claw_1', fundamentoTxHash: 'tx_memo_1', idempotente: true });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
    expect(m.decrementar).toHaveBeenCalledTimes(1);
    await executarClawback(IN);
    expect(m.decrementar).toHaveBeenCalledTimes(1);
  });
});

describe('erros fixos e validações (antes de qualquer registro ou execução)', () => {
  it.each([
    ['pedido ausente/curto/com caracteres inválidos', { pedidoId: 'x' }, 'PEDIDO_INVALIDO'],
    ['fundamento sem http(s)', { fundamentoUrl: 'ftp://x' }, 'FUNDAMENTO_INVALIDO'],
    ['valor zero', { amount: '0' }, 'VALOR_INVALIDO'],
    ['valor não numérico', { amount: 'abc' }, 'VALOR_INVALIDO'],
  ])('%s → %s, nada executado nem gravado', async (_n, over, code) => {
    await expect(executarClawback({ ...IN, ...over })).rejects.toMatchObject({ code });
    expect(m.executeClawback).not.toHaveBeenCalled();
    expect(m.eventos).toHaveLength(0);
  });

  it('sem a chave do emissor: EMISSOR_NAO_CONFIGURADO com mensagem que NÃO cita o nome da variável', async () => {
    delete process.env.STELLAR_ISSUER_SECRET;
    const e = await executarClawback(IN).catch((x) => x);
    expect(e.code).toBe('EMISSOR_NAO_CONFIGURADO');
    expect(e.message).not.toMatch(/STELLAR|SECRET|ISSUER/);
  });

  it('investidor inexistente: INVESTIDOR_NAO_ENCONTRADO sem repetir o id na mensagem', async () => {
    m.investidor = null;
    const e = await executarClawback(IN).catch((x) => x);
    expect(e.code).toBe('INVESTIDOR_NAO_ENCONTRADO');
    expect(e.message).not.toContain('inv_1');
    expect(m.eventos).toHaveLength(0);
  });
});
