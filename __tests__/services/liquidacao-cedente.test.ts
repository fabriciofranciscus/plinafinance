import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  blob: vi.fn(),
  ancora: vi.fn(),
  corrida: { v: false },
  lockFn: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    // a transação do mock reusa o mesmo banco em memória (sem rollback; o que importa é a ordem e a condição)
    $transaction: async (fn: (tx: unknown) => unknown) => fn((await import('@/lib/db')).db),
    $executeRaw: async (...args: unknown[]) => m.lockFn(...args),
    transferenciaPix: {
      // cópia (como o banco real): a linha lida não muda sozinha quando outro ator a altera depois
      findUnique: async ({ where }: { where: { cessaoId: string } }) => {
        const r = m.rows.find((x) => x.cessaoId === where.cessaoId);
        return r ? { ...r } : null;
      },
      create: async ({ data }: { data: Row }) => {
        if (m.corrida.v || m.rows.some((r) => r.cessaoId === data.cessaoId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = {
          id: `t${m.rows.length + 1}`, status: 'ENVIANDO', providerId: null, e2eId: null, comprovante: null, comprovanteSha256: null,
          comprovantePath: null, ancoraTxHash: null, motivoFalha: null, tentativa: 1, historico: null, criadoEm: new Date('2026-11-12T09:00:00.000Z'), ...data,
        };
        m.rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = m.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const alvo = m.rows.filter(
          (r) => r.id === where.id && (!where.status || r.status === where.status) && (where.tentativa === undefined || r.tentativa === where.tentativa) && (!where.OR || where.OR.some((c: Row) => (c.travaAte === null ? r.travaAte == null : r.travaAte != null && r.travaAte < c.travaAte.lt))),
        );
        alvo.forEach((r) => Object.assign(r, data));
        return { count: alvo.length };
      },
    },
  },
}));
vi.mock('@/lib/integrations/blob/comprovante-psp', async (orig) => ({
  ...(await orig<typeof import('@/lib/integrations/blob/comprovante-psp')>()),
  guardarComprovantePsp: m.blob,
}));
vi.mock('@/lib/stellar/ancora', async (orig) => ({
  ...(await orig<typeof import('@/lib/stellar/ancora')>()),
  ancorarSha256: m.ancora,
}));

import { ComprovanteBlobError } from '@/lib/integrations/blob/comprovante-psp';
import { criarSimuladoProvider } from '@/lib/integrations/psp/simulado';
import { PspError, type ConsultaPix, type PixProvider } from '@/lib/integrations/psp/types';
import { AncoraError } from '@/lib/stellar/ancora';
import { avancarTransferencia, inicioDaTentativa, pagarTitular, reabrirTransferencia } from '@/lib/services/liquidacao-cedente';

const AGORA = new Date('2026-11-12T09:00:00.000Z');
const CHAVE_PIX = 'maria.silva@example.com.br';
const IN = { cessaoId: 'cessao_1', valor: '123.45', chavePix: CHAVE_PIX, tipoChave: 'EMAIL' as const };
const CPF_OK = '529.982.247-25';
const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

/** Provedor de mentira: controla cada resposta e conta as chamadas. */
function provedor(over: Partial<{ nome: 'ASAAS' | 'SIMULADO'; envio: () => Promise<any>; consulta: () => Promise<ConsultaPix>; acha: () => Promise<any> }> = {}) {
  const p = {
    nome: over.nome ?? 'ASAAS',
    enviarPix: vi.fn(over.envio ?? (async () => ({ id: 'tra_1', status: 'PENDENTE' }))),
    consultarStatus: vi.fn(over.consulta ?? (async () => ({ id: 'tra_1', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E2E1', efetivadoEm: '2026-11-12' } as ConsultaPix))),
    localizarPorChave: vi.fn(over.acha ?? (async () => null)),
  };
  return p as typeof p & PixProvider;
}

beforeEach(() => {
  m.lockFn.mockReset().mockResolvedValue(0);
  m.rows.length = 0;
  m.corrida.v = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.blob.mockReset().mockImplementation(async ({ cessaoId }: { cessaoId: string }) => ({ pathname: `comprovantes-psp/${cessaoId}.json` }));
  m.ancora.mockReset().mockResolvedValue({ txHash: 'a'.repeat(64), reutilizada: false, ledgerCloseTime: '2026-11-12T09:00:05Z' });
});

describe('pagarTitular — caminho feliz', () => {
  it('claim → PSP → comprovante canônico → Blob → âncora (memo = SHA-256 do comprovante) → COMPROVADA', async () => {
    const p = provedor();
    const r = await pagarTitular(IN, { provider: p, agora: AGORA });
    expect(r).toMatchObject({ status: 'COMPROVADA', transferenciaId: 'tra_1', txHash: 'a'.repeat(64) });

    const row = m.rows[0];
    expect(row).toMatchObject({ status: 'COMPROVADA', idempotencyKey: 'pix-cedente:cessao_1', destinoMascarado: 'EMAIL m***@***.br', e2eId: 'E2E1', travaAte: null });
    expect(sha(row.comprovante)).toBe(row.comprovanteSha256);
    expect(r.sha256).toBe(row.comprovanteSha256);
    // os MESMOS bytes vão ao Blob e à âncora
    expect(m.blob.mock.calls[0][0].bytes.toString('utf8')).toBe(row.comprovante);
    expect(m.ancora).toHaveBeenCalledWith({ sha256Hex: row.comprovanteSha256, contexto: 'COMPROVANTE_PIX', desde: row.criadoEm });
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
    expect((p.enviarPix.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ idempotencyKey: 'pix-cedente:cessao_1', valor: '123.45', chavePix: CHAVE_PIX });
  });

  it('a chave Pix do titular não aparece no banco, no comprovante, no Blob, na âncora nem em log', async () => {
    await pagarTitular(IN, { provider: provedor(), agora: AGORA });
    const tudo = JSON.stringify([m.rows, m.blob.mock.calls.map((c) => c[0].bytes.toString('utf8')), m.ancora.mock.calls, (console.error as any).mock.calls]);
    expect(tudo).not.toMatch(/maria|silva|example\.com/i);
  });

  it('funciona com o provedor SIMULADO (fallback) e rotula o comprovante', async () => {
    const r = await pagarTitular(IN, { provider: criarSimuladoProvider(() => AGORA), agora: AGORA });
    expect(r.status).toBe('COMPROVADA');
    expect(JSON.parse(m.rows[0].comprovante)).toMatchObject({ provedor: 'SIMULADO', e2eId: null });
  });

  it('2ª chamada da mesma cessão: não paga de novo (1 envio, 1 âncora), mesmo hash', async () => {
    const p = provedor();
    const a = await pagarTitular(IN, { provider: p, agora: AGORA });
    const b = await pagarTitular(IN, { provider: p, agora: AGORA });
    expect(b).toEqual(a);
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
    expect(m.ancora).toHaveBeenCalledTimes(1);
    expect(m.rows).toHaveLength(1);
  });
});

describe('pagarTitular — PSP ainda processando, falha e recusa', () => {
  it('PENDENTE → PROCESSANDO; a retomada consulta e, concluído, comprova com os mesmos dados', async () => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status: 'PENDENTE' }) });
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('PROCESSANDO');
    expect(m.ancora).not.toHaveBeenCalled();
    p.consultarStatus.mockResolvedValue({ id: 'tra_1', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E2E1', efetivadoEm: '2026-11-12' });
    const r = await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    expect(r.status).toBe('COMPROVADA');
    expect(p.enviarPix).toHaveBeenCalledTimes(1); // retomar nunca reenvia
  });

  it.each(['FALHOU', 'CANCELADO'] as const)('PSP %s → FALHOU terminal, sem comprovante nem âncora, e nada é reenviado', async (status) => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status, motivoFalha: 'PSP_FALHA' }) });
    const r = await pagarTitular(IN, { provider: p, agora: AGORA });
    expect(r.status).toBe('FALHOU');
    expect(m.ancora).not.toHaveBeenCalled();
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('FALHOU');
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });

  it('PSP recusa o pedido (4xx): FALHOU/PSP_RECUSOU, nada ancorado', async () => {
    const p = provedor({ envio: async () => { throw new PspError('PSP_RECUSOU'); } });
    expect(await pagarTitular(IN, { provider: p, agora: AGORA })).toMatchObject({ status: 'FALHOU', motivoFalha: 'PSP_RECUSOU' });
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('valor devolvido pelo PSP diferente do pedido: não comprova nem ancora', async () => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status: 'CONCLUIDO', valor: '999.00' }) });
    await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'VALOR_DIVERGE' });
    expect(m.ancora).not.toHaveBeenCalled();
    expect(m.rows[0].comprovante).toBeNull();
    // F-E12-2: não fica PROCESSANDO em silêncio: estado de alerta, e nada o retoma sozinho
    expect(m.rows[0]).toMatchObject({ status: 'INCERTO', motivoFalha: 'PSP_VALOR_DIVERGE', travaAte: null });
    expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('INCERTO');
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });
});

describe('Atlas/Vera F-FIA-1: em STELLAR_NETWORK=PUBLIC nenhum provedor vira COMPROVADA (nem injetado)', () => {
  const comRede = async (rede: string, fn: () => Promise<void>) => {
    const antes = process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = rede;
    try { await fn(); } finally { if (antes === undefined) delete process.env.STELLAR_NETWORK; else process.env.STELLAR_NETWORK = antes; }
  };
  it('pagarTitular com provedor ASAAS injetado → PSP_CONFIG, sem claim, sem envio, sem comprovante, sem âncora', async () => {
    await comRede('PUBLIC', async () => {
      const p = provedor();
      await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'PSP_CONFIG' });
      expect(m.rows).toHaveLength(0);
      expect(p.enviarPix).not.toHaveBeenCalled();
      expect(p.consultarStatus).not.toHaveBeenCalled();
      expect(m.ancora).not.toHaveBeenCalled();
    });
  });
  it('avancarTransferencia e reabrirTransferencia também recusam em PUBLIC (uma linha pré-existente nunca chega a COMPROVADA)', async () => {
    const p = provedor();
    await pagarTitular(IN, { provider: p, agora: AGORA }); // testnet: COMPROVADA
    m.rows[0].status = 'PROCESSANDO';
    m.rows[0].ancoraTxHash = null;
    p.consultarStatus.mockClear();
    await comRede('PUBLIC', async () => {
      await expect(avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'PSP_CONFIG' });
      await expect(reabrirTransferencia({ ...IN, operador: 'admin-panel' }, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'PSP_CONFIG' });
    });
    expect(p.consultarStatus).not.toHaveBeenCalled();
    expect(m.rows[0].status).toBe('PROCESSANDO');
  });
});

describe('P3 (Argus): DONE sem o valor não comprova às cegas', () => {
  it('PSP concluído SEM valor → INCERTO/PSP_SEM_VALOR, sem comprovante nem âncora (alerta; nada retoma sozinho)', async () => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status: 'CONCLUIDO', e2eId: 'E1', efetivadoEm: '2026-11-12' }) });
    await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'VALOR_DIVERGE', causa: 'PSP_SEM_VALOR' });
    expect(m.rows[0]).toMatchObject({ status: 'INCERTO', motivoFalha: 'PSP_SEM_VALOR', comprovante: null });
    expect(m.ancora).not.toHaveBeenCalled();
    expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('INCERTO');
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });
  it('o provedor SIMULADO (que não tem valor para devolver) segue comprovando', async () => {
    const p = provedor({ nome: 'SIMULADO', consulta: async () => ({ id: 'tra_1', status: 'CONCLUIDO', efetivadoEm: '2026-11-12' }) });
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('COMPROVADA');
  });
});

describe('Consuelo (domínio): PSP real em DONE sem EndToEndId não comprova', () => {
  it('DONE sem e2eId → continua PROCESSANDO com PSP_SEM_E2E, sem comprovante nem âncora; quando o e2eId aparece, comprova e limpa o marcador', async () => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status: 'CONCLUIDO', valor: '123.45', e2eId: null, efetivadoEm: '2026-11-12' }) });
    const r = await pagarTitular(IN, { provider: p, agora: AGORA });
    expect(r.status).toBe('PROCESSANDO');
    expect(m.rows[0]).toMatchObject({ status: 'PROCESSANDO', motivoFalha: 'PSP_SEM_E2E', comprovante: null, travaAte: null });
    expect(m.ancora).not.toHaveBeenCalled();
    expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('PROCESSANDO'); // continua consultando
    p.consultarStatus.mockResolvedValue({ id: 'tra_1', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E2E9', efetivadoEm: '2026-11-12' });
    const f = await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    expect(f.status).toBe('COMPROVADA');
    expect(m.rows[0]).toMatchObject({ motivoFalha: null, e2eId: 'E2E9' });
    expect(JSON.parse(m.rows[0].comprovante).e2eId).toBe('E2E9');
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });
  it('o provedor SIMULADO (sem e2eId) segue comprovando', async () => {
    const p = provedor({ nome: 'SIMULADO', consulta: async () => ({ id: 'tra_1', status: 'CONCLUIDO', efetivadoEm: '2026-11-12' }) });
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('COMPROVADA');
  });
});

describe('pagarTitular — resposta ambígua: NUNCA reenvia sozinho', () => {
  const ambiguo = () => provedor({ envio: async () => { throw new PspError('PSP_INCERTO'); } });

  it('timeout/5xx no envio → INCERTO; a retomada só tenta ACHAR por chave e, sem achar, continua INCERTO (0 reenvios)', async () => {
    const p = ambiguo();
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('INCERTO');
    for (let i = 0; i < 3; i++) expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('INCERTO');
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
    expect(p.localizarPorChave).toHaveBeenCalledWith('pix-cedente:cessao_1', m.rows[0].criadoEm);
    expect(m.ancora).not.toHaveBeenCalled();
  });

  it('a transferência foi achada pela chave → segue de onde parou (consulta, comprova, ancora) sem reenviar', async () => {
    const p = ambiguo();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.localizarPorChave.mockResolvedValue({ id: 'tra_9', status: 'CONCLUIDO' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_9', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E9', efetivadoEm: '2026-11-12' });
    const r = await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    expect(r).toMatchObject({ status: 'COMPROVADA', transferenciaId: 'tra_9' });
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });

  it('queda depois do claim e antes da resposta (ENVIANDO sem providerId, lease vencido): vira busca, não novo envio', async () => {
    m.rows.push({ id: 't1', cessaoId: 'cessao_1', idempotencyKey: 'pix-cedente:cessao_1', provedor: 'ASAAS', status: 'ENVIANDO', valor: '123.45', destinoMascarado: 'EMAIL m***@***.br',
      providerId: null, comprovante: null, comprovanteSha256: null, travaAte: new Date(AGORA.getTime() - 1), criadoEm: AGORA });
    const p = provedor();
    expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('INCERTO');
    expect(p.enviarPix).not.toHaveBeenCalled();
  });

  it('erro de leitura ao procurar (Horizon do PSP fora): continua INCERTO, não reenvia', async () => {
    const p = provedor({ acha: async () => { throw new PspError('PSP_INCERTO'); } });
    m.rows.push({ id: 't1', cessaoId: 'cessao_1', idempotencyKey: 'pix-cedente:cessao_1', provedor: 'ASAAS', status: 'INCERTO', valor: '123.45', destinoMascarado: 'x',
      providerId: null, comprovante: null, comprovanteSha256: null, travaAte: null, criadoEm: AGORA });
    expect((await avancarTransferencia('cessao_1', { provider: p, agora: AGORA })).status).toBe('INCERTO');
    expect(p.enviarPix).not.toHaveBeenCalled();
  });
});

describe('pagarTitular — comprovante e âncora com retomada', () => {
  it('Blob falha: nada ancorado; a repetição usa os MESMOS bytes do comprovante e conclui', async () => {
    m.blob.mockRejectedValueOnce(new ComprovanteBlobError('FALHOU'));
    const p = provedor();
    await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'COMPROVANTE_FALHOU' });
    expect(m.ancora).not.toHaveBeenCalled();
    const hash = m.rows[0].comprovanteSha256;
    expect(m.rows[0]).toMatchObject({ status: 'PROCESSANDO', travaAte: null });
    // O PSP agora devolve outra data: os bytes já gravados não podem mudar.
    p.consultarStatus.mockResolvedValue({ id: 'tra_1', status: 'CONCLUIDO', valor: '123.45', e2eId: 'OUTRO', efetivadoEm: '2030-01-01' });
    const r = await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    expect(r).toMatchObject({ status: 'COMPROVADA', sha256: hash });
    expect(sha(m.blob.mock.calls[1][0].bytes.toString('utf8'))).toBe(hash);
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });

  it('âncora falha: fica PROCESSANDO com o comprovante guardado; a repetição ancora o MESMO hash', async () => {
    m.ancora.mockRejectedValueOnce(new AncoraError('ANCORA_NAO_CONFIRMADA'));
    const p = provedor();
    await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'ANCORA_FALHOU', causa: 'ANCORA_NAO_CONFIRMADA' });
    expect(m.rows[0]).toMatchObject({ status: 'PROCESSANDO', ancoraTxHash: null });
    await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    expect(m.ancora.mock.calls[1][0].sha256Hex).toBe(m.ancora.mock.calls[0][0].sha256Hex);
    expect(m.rows[0].status).toBe('COMPROVADA');
  });
});

describe('pagarTitular — entrada, divergência e concorrência', () => {
  it.each([
    ['campo extra (strict)', { ...IN, extra: 1 }],
    ['valor sem 2 casas', { ...IN, valor: '1.5' }],
    ['valor zero', { ...IN, valor: '0.00' }],
    ['tipo inválido', { ...IN, tipoChave: 'X' }],
    ['sem cessão', { ...IN, cessaoId: '' }],
  ])('entrada inválida (%s): recusa antes de claim e de PSP', async (_n, entrada) => {
    const p = provedor();
    await expect(pagarTitular(entrada as never, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    expect(m.rows).toHaveLength(0);
    expect(p.enviarPix).not.toHaveBeenCalled();
  });

  it('valor diferente do já registrado e provedor diferente: recusa sem pagar', async () => {
    const p = provedor();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    await expect(pagarTitular({ ...IN, valor: '999.00' }, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'VALOR_DIVERGE' });
    await expect(pagarTitular(IN, { provider: provedor({ nome: 'SIMULADO' }), agora: AGORA })).rejects.toMatchObject({ code: 'PROVEDOR_DIVERGE' });
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });

  it('corrida no claim (P2002) ou lease de outra execução: EM_ANDAMENTO, nenhum envio', async () => {
    m.corrida.v = true;
    const p = provedor();
    await expect(pagarTitular(IN, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'EM_ANDAMENTO' });
    m.corrida.v = false;
    m.rows.push({ id: 't1', cessaoId: 'cessao_2', idempotencyKey: 'pix-cedente:cessao_2', provedor: 'ASAAS', status: 'ENVIANDO', valor: '123.45', destinoMascarado: 'x',
      providerId: null, travaAte: new Date(AGORA.getTime() + 60_000), criadoEm: AGORA });
    await expect(pagarTitular({ ...IN, cessaoId: 'cessao_2' }, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'EM_ANDAMENTO' });
    expect(p.enviarPix).not.toHaveBeenCalled();
  });

  it('avancarTransferencia sem pagamento registrado: erro claro, sem rede', async () => {
    const p = provedor();
    await expect(avancarTransferencia('nada', { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'TRANSFERENCIA_NAO_ENCONTRADA' });
    expect(p.consultarStatus).not.toHaveBeenCalled();
  });
});

describe('F-E12-1 — chave Pix validada por tipo antes do claim', () => {
  it.each([
    ['CPF com dígito verificador errado', { tipoChave: 'CPF' as const, chavePix: '529.982.247-26' }],
    ['CPF de dígitos repetidos', { tipoChave: 'CPF' as const, chavePix: '111.111.111-11' }],
    ['CNPJ inválido', { tipoChave: 'CNPJ' as const, chavePix: '11.222.333/0001-80' }],
    ['telefone sem DDD', { tipoChave: 'PHONE' as const, chavePix: '999998877' }],
    ['e-mail sem domínio', { tipoChave: 'EMAIL' as const, chavePix: 'maria@' }],
    ['EVP que não é UUID', { tipoChave: 'EVP' as const, chavePix: 'abc' }],
  ])('%s: ENTRADA_INVALIDA sem claim e sem PSP (a tentativa não é queimada)', async (_n, troca) => {
    const p = provedor();
    await expect(pagarTitular({ ...IN, ...troca }, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA', causa: 'CHAVE_PIX_INVALIDA' });
    expect(m.rows).toHaveLength(0);
    expect(p.enviarPix).not.toHaveBeenCalled();
  });

  it('CPF válido é normalizado (só dígitos) antes de ir ao PSP e a máscara usa a chave normalizada', async () => {
    const p = provedor();
    await pagarTitular({ ...IN, tipoChave: 'CPF', chavePix: CPF_OK }, { provider: p, agora: AGORA });
    expect((p.enviarPix.mock.calls[0] as unknown as [Record<string, string>])[0].chavePix).toBe('52998224725');
    expect(m.rows[0].destinoMascarado).toBe('CPF ***4725');
  });
});

describe('F-E12-1 — reabrir um FALHOU confirmado pelo PSP (auditado, chave nova)', () => {
  const recusa = () => provedor({ envio: async () => { throw new PspError('PSP_RECUSOU'); } });
  const REABRIR = { ...IN, operador: 'admin-panel' };

  it('expõe o início da tentativa atual (a hora da reabertura)', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    const REABERTURA = new Date('2026-11-12T15:00:00.000Z');
    await reabrirTransferencia(REABRIR, { provider: p, agora: REABERTURA });
    expect(inicioDaTentativa(m.rows[0] as never)).toEqual(REABERTURA);
  });

  it('FALHOU (PSP recusou) → reabre com idempotencyKey :2, guarda a tentativa anterior no histórico e conclui', async () => {
    const p = recusa();
    expect((await pagarTitular(IN, { provider: p, agora: AGORA })).status).toBe('FALHOU');
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E2', efetivadoEm: '2026-11-12' });
    const r = await reabrirTransferencia(REABRIR, { provider: p, agora: AGORA });
    expect(r).toMatchObject({ status: 'COMPROVADA', transferenciaId: 'tra_2' });
    expect(p.enviarPix).toHaveBeenCalledTimes(2);
    expect((p.enviarPix.mock.calls[1] as unknown as [Record<string, string>])[0].idempotencyKey).toBe('pix-cedente:cessao_1:2');
    expect(m.rows[0]).toMatchObject({ tentativa: 2, idempotencyKey: 'pix-cedente:cessao_1:2', status: 'COMPROVADA' });
    expect(m.rows[0].historico).toEqual([
      { tentativa: 1, idempotencyKey: 'pix-cedente:cessao_1', providerId: null, motivoFalha: 'PSP_RECUSOU', reabertaEm: AGORA.toISOString(), operador: 'admin-panel' },
    ]);
  });

  it.each(['INCERTO', 'PROCESSANDO', 'COMPROVADA'] as const)('estado %s NÃO reabre (o dinheiro pode ter saído): NAO_REABRIVEL, 0 envios novos', async (estado) => {
    const p = provedor({ consulta: async () => ({ id: 'tra_1', status: 'PENDENTE' }) });
    await pagarTitular(IN, { provider: p, agora: AGORA });
    Object.assign(m.rows[0], { status: estado });
    p.enviarPix.mockClear();
    await expect(reabrirTransferencia(REABRIR, { provider: p, agora: AGORA })).rejects.toMatchObject({ code: 'NAO_REABRIVEL', causa: estado });
    expect(p.enviarPix).not.toHaveBeenCalled();
  });

  it('duas reaberturas simultâneas = UMA (a segunda não reenvia)', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockClear();
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    const [a, b] = await Promise.allSettled([reabrirTransferencia(REABRIR, { provider: p, agora: AGORA }), reabrirTransferencia(REABRIR, { provider: p, agora: AGORA })]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });

  it('reaberta e ambígua: a recuperação procura a chave atual E a da tentativa anterior', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockRejectedValue(new PspError('PSP_INCERTO'));
    expect((await reabrirTransferencia(REABRIR, { provider: p, agora: AGORA })).status).toBe('INCERTO');
    await avancarTransferencia('cessao_1', { provider: p, agora: AGORA });
    const chaves = (p.localizarPorChave.mock.calls as unknown as string[][]).map((c) => c[0]);
    expect(chaves).toEqual(expect.arrayContaining(['pix-cedente:cessao_1:2', 'pix-cedente:cessao_1']));
    expect(p.enviarPix).toHaveBeenCalledTimes(2); // original + reabertura; a recuperação não reenviou
  });

  it('depois de reabrir, o desde da âncora e da busca é a hora da REABERTURA (a janela não volta ao claim original)', async () => {
    const REABERTURA = new Date('2026-11-12T15:00:00.000Z');
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'CONCLUIDO', valor: '123.45', e2eId: 'E2', efetivadoEm: '2026-11-12' });
    await reabrirTransferencia(REABRIR, { provider: p, agora: REABERTURA });
    expect(m.ancora.mock.calls[0][0].desde).toEqual(REABERTURA);
    // 1ª tentativa continua ancorando com o claim original
    const q = provedor();
    m.rows.length = 0;
    await pagarTitular({ ...IN, cessaoId: 'cessao_9' }, { provider: q, agora: AGORA });
    expect(m.ancora.mock.calls[1][0].desde).toEqual(m.rows[0].criadoEm);
  });

  it('reaberta e ambígua: a busca da chave atual usa a reabertura e a das anteriores usa o claim', async () => {
    const REABERTURA = new Date('2026-11-12T15:00:00.000Z');
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockRejectedValue(new PspError('PSP_INCERTO'));
    await reabrirTransferencia(REABRIR, { provider: p, agora: REABERTURA });
    await avancarTransferencia('cessao_1', { provider: p, agora: REABERTURA });
    const chamadas = p.localizarPorChave.mock.calls as unknown as Array<[string, Date]>;
    expect(chamadas.find((c) => c[0] === 'pix-cedente:cessao_1:2')?.[1]).toEqual(REABERTURA);
    expect(chamadas.find((c) => c[0] === 'pix-cedente:cessao_1')?.[1]).toEqual(m.rows[0].criadoEm);
  });

  it('F-REAB-1: o aoReabrir (auditoria) roda DENTRO da transação da reabertura, só quando ela se aplicou, com os dados da tentativa substituída', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    const aoReabrir = vi.fn(async () => undefined);
    await reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir });
    expect(aoReabrir).toHaveBeenCalledOnce();
    expect((aoReabrir.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toEqual({
      provedor: 'ASAAS', tentativaAnterior: 1, tentativaNova: 2, idempotencyKeyAnterior: 'pix-cedente:cessao_1', motivoAnterior: 'PSP_RECUSOU', providerIdAnterior: null,
    });
    expect(m.rows[0].tentativa).toBe(2); // a reabertura se aplicou junto com o hook
  });

  it('F-REAB-1 (Consuelo): a reabertura trava a cessão (advisory lock), RELÊ a linha sob o lock e só então aplica e audita', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    const ordem: string[] = [];
    m.lockFn.mockImplementation(async (_s: unknown, chave: unknown) => { ordem.push(`lock:${String(chave)}`); return 0; });
    await reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir: async () => { ordem.push('hook'); } });
    expect(ordem).toEqual(['lock:plina:pix-cessao:cessao_1', 'hook']); // o lock vem antes da auditoria; a mesma chave do fechamento
  });

  it('F-REAB-1: se a linha mudou ENTRE a primeira leitura e o lock (outro ator passou na frente), a releitura sob o lock recusa: nada é reaberto nem auditado', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    const aoReabrir = vi.fn(async () => undefined);
    // enquanto o lock é tomado, a linha deixa de ser FALHOU (ex.: foi reaberta e já está PROCESSANDO)
    m.lockFn.mockImplementation(async () => { m.rows[0].status = 'PROCESSANDO'; return 0; });
    await expect(reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir })).rejects.toMatchObject({ code: 'NAO_REABRIVEL', causa: 'PROCESSANDO' });
    expect(aoReabrir).not.toHaveBeenCalled();
    expect(m.rows[0].tentativa).toBe(1);
    expect(p.enviarPix).toHaveBeenCalledTimes(1); // nenhum envio novo
    // e se outra reabertura trocou a tentativa mas voltou a FALHOU: a tentativa difere → EM_ANDAMENTO
    m.rows[0].status = 'FALHOU';
    m.lockFn.mockImplementation(async () => { m.rows[0].tentativa = 2; return 0; });
    await expect(reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir })).rejects.toMatchObject({ code: 'EM_ANDAMENTO' });
    expect(aoReabrir).not.toHaveBeenCalled();
  });

  it('F-REAB-1: duas reaberturas simultâneas = UM aoReabrir (a perdedora não deixa evento nem envio); estado que não é FALHOU nunca chama o hook', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    p.enviarPix.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    p.consultarStatus.mockResolvedValue({ id: 'tra_2', status: 'PENDENTE' });
    const aoReabrir = vi.fn(async () => undefined);
    const [a, b] = await Promise.allSettled([
      reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir }),
      reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(aoReabrir).toHaveBeenCalledOnce();
    const outro = vi.fn(async () => undefined);
    m.rows[0].status = 'PROCESSANDO';
    await expect(reabrirTransferencia(REABRIR, { provider: p, agora: AGORA, aoReabrir: outro })).rejects.toMatchObject({ code: 'NAO_REABRIVEL' });
    expect(outro).not.toHaveBeenCalled();
  });

  it('exige operador identificado, a chave Pix válida e o mesmo valor/provedor', async () => {
    const p = recusa();
    await pagarTitular(IN, { provider: p, agora: AGORA });
    await expect(reabrirTransferencia({ ...REABRIR, operador: '' }, { provider: p })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    await expect(reabrirTransferencia({ ...REABRIR, chavePix: 'sem-arroba' }, { provider: p })).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    await expect(reabrirTransferencia({ ...REABRIR, valor: '1.00' }, { provider: p })).rejects.toMatchObject({ code: 'VALOR_DIVERGE' });
    await expect(reabrirTransferencia({ ...REABRIR, cessaoId: 'nada' }, { provider: p })).rejects.toMatchObject({ code: 'TRANSFERENCIA_NAO_ENCONTRADA' });
    expect(p.enviarPix).toHaveBeenCalledTimes(1);
  });
});
