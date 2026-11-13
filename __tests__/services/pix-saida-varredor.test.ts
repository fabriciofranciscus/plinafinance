import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), avancar: vi.fn(), fechar: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { transferenciaPix: { findMany: m.findMany, updateMany: m.updateMany } } }));
vi.mock('@/lib/services/liquidacao-cedente', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/liquidacao-cedente')>()),
  avancarTransferencia: m.avancar,
}));
vi.mock('@/lib/services/pagamento-cedente', () => ({ fecharPagamento: m.fechar }));

import { marcarPixAvisados, varrerPixSaida } from '@/lib/services/pix-saida-varredor';

const AGORA = new Date('2026-11-12T12:00:00.000Z');
const minAtras = (n: number) => new Date(AGORA.getTime() - n * 60_000);
const aberta = (cessaoId: string, status: string, over: Record<string, unknown> = {}) => ({
  cessaoId, status, motivoFalha: null, criadoEm: minAtras(5), historico: null, alertadoEm: null, ...over,
});

/** 1ª leitura: abertas a avançar; 2ª: comprovadas recentes; 3ª: estado final para as contagens. */
function banco(abertas: unknown[], comprovadas: unknown[], final: unknown[]) {
  m.findMany.mockReset()
    .mockResolvedValueOnce(abertas)
    .mockResolvedValueOnce(comprovadas)
    .mockResolvedValueOnce(final);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  m.avancar.mockReset().mockResolvedValue({ status: 'PROCESSANDO' });
  m.fechar.mockReset().mockResolvedValue({ criado: true, pagamentoId: 'p' });
  m.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('varrerPixSaida', () => {
  it('sem nada aberto: tudo zero, sem alerta', async () => {
    banco([], [], []);
    expect(await varrerPixSaida({ agora: AGORA })).toMatchObject({ avancadas: 0, comprovadas: 0, processando: 0, incertos: 0, alerta: false, paraAvisar: [] });
  });

  it('avança cada transferência aberta SEM reenviar e fecha o pagamento das que viraram COMPROVADA', async () => {
    banco([{ cessaoId: 'c1' }, { cessaoId: 'c2' }], [], [aberta('c2', 'PROCESSANDO')]);
    m.avancar.mockResolvedValueOnce({ status: 'COMPROVADA' }).mockResolvedValueOnce({ status: 'PROCESSANDO' });
    const r = await varrerPixSaida({ agora: AGORA });
    expect(m.avancar).toHaveBeenCalledTimes(2);
    expect(m.fechar).toHaveBeenCalledTimes(1);
    expect(m.fechar).toHaveBeenCalledWith('c1');
    expect(r).toMatchObject({ avancadas: 2, comprovadas: 1, processando: 1, alerta: false });
  });

  it('comprovadas que ficaram sem Pagamento (queda antes do fechamento) são fechadas; as já fechadas não contam de novo', async () => {
    banco([], [{ cessaoId: 'c1' }, { cessaoId: 'c2' }], []);
    m.fechar.mockResolvedValueOnce({ criado: true, pagamentoId: 'p1' }).mockResolvedValueOnce({ criado: false, pagamentoId: 'p2' });
    expect((await varrerPixSaida({ agora: AGORA })).comprovadas).toBe(1);
  });

  it('erro numa transferência não derruba as outras (conta em erros, sem vazar a causa)', async () => {
    banco([{ cessaoId: 'c1' }, { cessaoId: 'c2' }], [], [aberta('c1', 'PROCESSANDO'), aberta('c2', 'PROCESSANDO')]);
    m.avancar.mockRejectedValueOnce(new Error('postgres://u:s@h')).mockResolvedValueOnce({ status: 'PROCESSANDO' });
    const r = await varrerPixSaida({ agora: AGORA });
    expect(r).toMatchObject({ avancadas: 1, erros: 1 });
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/postgres|senha/);
  });

  it.each([
    ['INCERTO', [aberta('c1', 'INCERTO')], { incertos: 1, alerta: true }],
    ['VALOR_DIVERGE', [aberta('c1', 'INCERTO', { motivoFalha: 'PSP_VALOR_DIVERGE' })], { valorDiverge: 1, incertos: 1, alerta: true }],
    ['DONE sem EndToEndId (PSP_SEM_E2E), mesmo recente', [aberta('c1', 'PROCESSANDO', { motivoFalha: 'PSP_SEM_E2E' })], { semE2eId: 1, processando: 1, alerta: true }],
    ['FALHOU (cedente não pago, esperando decisão de reabrir)', [aberta('c1', 'FALHOU', { motivoFalha: 'PSP_RECUSOU' })], { falhados: 1, processando: 0, alerta: true }],
    ['PROCESSANDO há mais de 30 min', [aberta('c1', 'PROCESSANDO', { criadoEm: minAtras(31) })], { processandoAntigas: 1, processando: 1, alerta: true }],
    ['ENVIANDO há mais de 30 min', [aberta('c1', 'ENVIANDO', { criadoEm: minAtras(45) })], { processandoAntigas: 1, alerta: true }],
  ])('alerta: %s', async (_n, final, esperado) => {
    banco([], [], final);
    expect(await varrerPixSaida({ agora: AGORA })).toMatchObject({ ...esperado, paraAvisar: ['c1'] });
  });

  it('PROCESSANDO há menos de 30 min NÃO alerta (borda: 30 min exatos ainda não)', async () => {
    banco([], [], [aberta('c1', 'PROCESSANDO', { criadoEm: minAtras(29) }), aberta('c2', 'PROCESSANDO', { criadoEm: minAtras(30) })]);
    expect((await varrerPixSaida({ agora: AGORA })).alerta).toBe(false);
  });

  it('F-FIA-5: a idade conta desde a REABERTURA, não desde o 1º claim (reaberta há 5 min não alerta; reaberta há 40 min alerta)', async () => {
    const reaberta = (min: number) => [{ tentativa: 1, idempotencyKey: 'k', providerId: null, motivoFalha: 'PSP_RECUSOU', reabertaEm: minAtras(min).toISOString(), operador: 'a' }];
    banco([], [], [aberta('c1', 'PROCESSANDO', { criadoEm: minAtras(600), historico: reaberta(5) })]);
    expect((await varrerPixSaida({ agora: AGORA })).alerta).toBe(false);
    banco([], [], [aberta('c1', 'PROCESSANDO', { criadoEm: minAtras(600), historico: reaberta(40) })]);
    expect((await varrerPixSaida({ agora: AGORA })).processandoAntigas).toBe(1);
  });

  it('F-FIA-7: o lote rotaciona (menos recentemente tocadas primeiro), então travadas não ocupam os 20 para sempre', async () => {
    banco([], [], []);
    await varrerPixSaida({ agora: AGORA });
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ orderBy: { atualizadoEm: 'asc' }, take: 20 });
  });

  it('dedupe: alerta continua true, mas só avisa por e-mail as cessões ainda não avisadas', async () => {
    banco([], [], [aberta('c1', 'INCERTO', { alertadoEm: minAtras(10) }), aberta('c2', 'INCERTO')]);
    const r = await varrerPixSaida({ agora: AGORA });
    expect(r.alerta).toBe(true);
    expect(r.paraAvisar).toEqual(['c2']);
  });
});

describe('marcarPixAvisados', () => {
  it('marca só as cessões informadas; lista vazia não toca no banco', async () => {
    await marcarPixAvisados([]);
    expect(m.updateMany).not.toHaveBeenCalled();
    await marcarPixAvisados(['c1', 'c2']);
    expect(m.updateMany.mock.calls[0][0].where).toEqual({ cessaoId: { in: ['c1', 'c2'] } });
  });
});
