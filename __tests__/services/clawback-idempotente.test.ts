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

/** Memo do fundamento REJEITADO pela rede (result_codes): prova que ele não entrou, então o reenvio pode refazê-lo na hora. */
const memoRejeitado = () => Object.assign(new Error('memo caiu'), { response: { data: { extras: { result_codes: { transaction: 'tx_failed' } } } } });

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
    m.eventos.push({ id: 'ev_x', acao: 'CLAWBACK_EXECUTADO', investidorId: 'inv_1', motivoClawback: IN.motivo, fundamentoUrl: IN.fundamentoUrl, payloadJson: { pedidoId: IN.pedidoId, amount: '100', status: 'attempting' } });
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'PEDIDO_EM_ANDAMENTO' });
    expect(m.executeClawback).not.toHaveBeenCalled();
  });

  const rejeicaoDaRede = (transaction: string) =>
    Object.assign(new Error('horizon: segredo xyz e ana@exemplo.test'), { response: { data: { extras: { result_codes: { transaction, operations: ['op_no_trust'] } } } } });

  it('R2: REJEIÇÃO DEFINITIVA da rede (result_codes) → marca failed, erro fixo EXECUCAO_FALHOU; o mesmo pedido NÃO reexecuta (PEDIDO_FALHOU)', async () => {
    m.executeClawback.mockRejectedValueOnce(rejeicaoDaRede('tx_failed'));
    const e1 = await executarClawback(IN).catch((e) => e);
    expect(e1).toBeInstanceOf(ClawbackError);
    expect(e1.code).toBe('EXECUCAO_FALHOU');
    expect(e1.message).not.toMatch(/xyz|exemplo\.test|horizon/);
    expect(m.eventos[0]!.payloadJson.status).toBe('failed');
    await expect(executarClawback(IN)).rejects.toMatchObject({ code: 'PEDIDO_FALHOU' });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout/queda de conexão (sem result_codes)', () => new Error('ETIMEDOUT: segredo xyz')],
    ['5xx do Horizon (sem result_codes)', () => Object.assign(new Error('502'), { response: { status: 502, data: { status: 502 } } })],
    ['tx_too_late (não prova que não entrou)', () => rejeicaoDaRede('tx_too_late')],
    ['tx_bad_seq (idem)', () => rejeicaoDaRede('tx_bad_seq')],
  ])('R2: %s → pedido fica INCERTO (nunca "failed"), mensagem "pode ter entrado na rede; NÃO crie outro pedido", e o mesmo pedido recusa sem reexecutar', async (_n, erro) => {
    m.executeClawback.mockRejectedValueOnce(erro());
    const e1 = await executarClawback(IN).catch((e) => e);
    expect(e1.code).toBe('EXECUCAO_INCERTA');
    expect(e1.message).toMatch(/pode ter entrado na rede/);
    expect(e1.message).toMatch(/NÃO crie outro pedido/);
    expect(e1.message).not.toMatch(/xyz|ETIMEDOUT/);
    expect(m.eventos[0]!.payloadJson.status).toBe('incerto');
    const e2 = await executarClawback(IN).catch((e) => e);
    expect(e2.code).toBe('EXECUCAO_INCERTA');
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
    expect(m.decrementar).not.toHaveBeenCalled();
  });

  it('R1: reenvio do MESMO pedido com outra URL de fundamento ou outro motivo → PEDIDO_INVALIDO e NADA é ancorado com a URL nova (nem na retomada)', async () => {
    m.registerOnChainHash.mockRejectedValueOnce(memoRejeitado()); // deixa o pedido em `onchain` (retomável na hora: rejeição DEFINITIVA da rede)
    await executarClawback(IN).catch(() => undefined);
    m.registerOnChainHash.mockClear();
    await expect(executarClawback({ ...IN, fundamentoUrl: 'https://outro.test/falso.pdf' })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    await expect(executarClawback({ ...IN, motivo: 'FRAUDE_DOCUMENTAL' as never })).rejects.toMatchObject({ code: 'PEDIDO_INVALIDO' });
    expect(m.registerOnChainHash).not.toHaveBeenCalled();
    // com os dados IGUAIS a retomada segue e ancora o fundamento do REGISTRO
    await executarClawback(IN);
    expect(m.registerOnChainHash.mock.calls[0]![0]).toMatchObject({ fundamentoUrl: 'https://x.test/decisao.pdf', motivo: 'ERRO_OPERACIONAL' });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
  });

  it('o clawback já foi à rede mas o registro falhou (memo): erro REGISTRO_PENDENTE com o txHash; o MESMO pedido RETOMA sem reexecutar o clawback nem decrementar duas vezes', async () => {
    m.registerOnChainHash.mockRejectedValueOnce(memoRejeitado());
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
    // Formato (Flora I2 / I3): o SDK da Stellar recusa >7 casas, 0, negativo e enorme só DEPOIS de a tentativa ser gravada (o pedido
    // ficava `incerto` sem nada ter sido enviado), e aceita notação científica ("1e3" gravado cru na auditoria, 1000 na rede).
    ['notação científica', { amount: '1e3' }, 'VALOR_INVALIDO'],
    ['notação científica negativa', { amount: '1e-3' }, 'VALOR_INVALIDO'],
    ['mais de 7 casas', { amount: '0.00000001' }, 'VALOR_INVALIDO'],
    ['mais de 12 dígitos inteiros', { amount: '1234567890123' }, 'VALOR_INVALIDO'],
    ['negativo', { amount: '-5' }, 'VALOR_INVALIDO'],
    ['com espaço', { amount: ' 5 ' }, 'VALOR_INVALIDO'],
    ['vírgula decimal', { amount: '1,5' }, 'VALOR_INVALIDO'],
    ['vazio', { amount: '' }, 'VALOR_INVALIDO'],
    ['zero com casas', { amount: '0.0000000' }, 'VALOR_INVALIDO'],
    ['hexadecimal', { amount: '0x10' }, 'VALOR_INVALIDO'],
  ])('%s → %s, nada executado nem gravado', async (_n, over, code) => {
    await expect(executarClawback({ ...IN, ...over })).rejects.toMatchObject({ code });
    expect(m.executeClawback).not.toHaveBeenCalled();
    expect(m.eventos).toHaveLength(0);
  });

  it.each(['100', '0.0000001', '999999999999.9999999', '1', '0.5', '1234.5'])('quantidade %s (decimal puro, até 12 inteiros e 7 casas) é aceita e vai ao anchor como veio', async (amount) => {
    await executarClawback({ ...IN, amount });
    expect(m.executeClawback).toHaveBeenCalledTimes(1);
    expect(m.executeClawback.mock.calls[0]![2]).toBe(amount);
  });

  // Trava da carteira (Argus 22:05; backlog pós-tag): a carteira mostrada na revisão tem de ser a lida AGORA no envio. Divergiu →
  // CARTEIRA_DIVERGENTE antes de gravar a tentativa e de qualquer envio (o pedidoId não é consumido).
  describe('carteira revisada', () => {
    it('igual à carteira lida no envio: executa para essa carteira', async () => {
      await executarClawback({ ...IN, carteiraRevisada: 'GABC' });
      expect(m.executeClawback).toHaveBeenCalledTimes(1);
      expect(m.executeClawback.mock.calls[0]![1]).toBe('GABC');
    });
    it('espaços ao redor são ignorados na comparação', async () => {
      await executarClawback({ ...IN, carteiraRevisada: '  GABC  ' });
      expect(m.executeClawback).toHaveBeenCalledTimes(1);
    });
    it.each([['outra chave', 'GXYZ'], ['minúscula', 'gabc'], ['prefixo', 'GAB'], ['sufixo', 'GABCD']])('%s → CARTEIRA_DIVERGENTE, nada executado nem gravado', async (_n, revisada) => {
      await expect(executarClawback({ ...IN, carteiraRevisada: revisada })).rejects.toMatchObject({ code: 'CARTEIRA_DIVERGENTE' });
      expect(m.executeClawback).not.toHaveBeenCalled();
      expect(m.eventos).toHaveLength(0);
    });
    it('a carteira do investidor mudou DEPOIS da revisão: recusa, e o mesmo pedidoId segue livre para um novo envio com a carteira nova', async () => {
      m.investidor = { id: 'inv_1', publicKey: 'GNOVA', saldoEsperado: '1000' };
      await expect(executarClawback({ ...IN, carteiraRevisada: 'GABC' })).rejects.toMatchObject({ code: 'CARTEIRA_DIVERGENTE' });
      expect(m.eventos).toHaveLength(0);
      await executarClawback({ ...IN, carteiraRevisada: 'GNOVA' });
      expect(m.executeClawback).toHaveBeenCalledTimes(1);
      expect(m.executeClawback.mock.calls[0]![1]).toBe('GNOVA');
    });
    it('a mensagem é fixa e não cita nenhuma das duas carteiras', async () => {
      const err = await executarClawback({ ...IN, carteiraRevisada: 'GXYZSEGREDO' }).catch((e) => e);
      expect(err).toBeInstanceOf(ClawbackError);
      expect(err.message).not.toMatch(/GXYZ|GABC|SEGREDO/);
    });
    it('a divergência vem antes da leitura do pedido: pedido já executado + carteira divergente também recusa (sem devolver o resultado do 1º)', async () => {
      await executarClawback({ ...IN, carteiraRevisada: 'GABC' });
      await expect(executarClawback({ ...IN, carteiraRevisada: 'GXYZ' })).rejects.toMatchObject({ code: 'CARTEIRA_DIVERGENTE' });
    });
    // Compatibilidade até o PR 3 do U1-11 (a tela atual não tem revisão da carteira): sem o campo, o comportamento é o de antes.
    // O PR 3 DEVE enviar sempre; torná-lo obrigatório é recusar aqui (decisão do Argus/Atlas).
    it('sem carteiraRevisada (tela atual): comportamento anterior, executa', async () => {
      await executarClawback(IN);
      expect(m.executeClawback).toHaveBeenCalledTimes(1);
    });
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
