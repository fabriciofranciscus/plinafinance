import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ref: vi.fn(), reconciliar: vi.fn(), consume: vi.fn(), alerta: vi.fn(), marcar: vi.fn(), marcarResgate: vi.fn() }));
vi.mock('@/lib/services/preco-referencia-tesouro', () => ({ obterPrecoReferenciaTesouro: m.ref }));
vi.mock('@/lib/services/alerta-ops', () => ({ enviarAlertaOps: m.alerta }));
vi.mock('@/lib/services/swap-escrituracao', () => ({ reconciliarSwapsOrfaos: m.reconciliar, marcarConflitosAlertados: m.marcar, marcarConflitosResgateAlertados: m.marcarResgate }));
vi.mock('@/lib/rate-limit/config', () => ({
  publicLimiter: { consume: m.consume },
  clientIp: () => '203.0.113.9',
}));

import { GET } from '@/app/api/ops/reconciliar-subscricoes/route';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 64 hex, como `openssl rand -hex 32`
const RESULTADO = {
  escriturados: 1, liberados: 1, aguardando: 0, vencidasSemProva: 0, semHash: 0,
  vigiaEscrituradas: 0, vigiaConflitos: 0, vigiaRestantes: 0, conflitoQuoteIds: [] as string[],
  resgatesVigiaEscrituradas: 0, resgatesVigiaConflitos: 0, resgatesVigiaRestantes: 0, conflitoResgateIds: [] as string[], erros: 0,
};
const req = (auth?: string) =>
  new Request('http://x/api/ops/reconciliar-subscricoes', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.OPS_CRON_SECRET = SECRET;
  m.reconciliar.mockReset().mockResolvedValue(RESULTADO);
  m.ref.mockReset().mockResolvedValue({ status: 'OK' });
  m.consume.mockReset().mockResolvedValue(true);
  m.alerta.mockReset().mockResolvedValue(true);
  m.marcar.mockReset().mockResolvedValue(undefined);
  m.marcarResgate.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.OPS_CRON_SECRET;
});

describe('GET /api/ops/reconciliar-subscricoes', () => {
  it('com o Bearer certo → 200 e só as contagens', async () => {
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    const { conflitoQuoteIds: _ids, conflitoResgateIds: _rids, ...contagens } = RESULTADO;
    expect(await r.json()).toEqual({ ...contagens, referenciaPreco: 'OK', alerta: false, alertaEnviado: false });
    expect(m.alerta).not.toHaveBeenCalled(); // sem conflito, sem e-mail
    expect(m.reconciliar).toHaveBeenCalledOnce();
  });

  it('conflito novo na vigia (emissão dupla): manda o e-mail de alerta com os ids e liga alerta na resposta (sem vazar os ids)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: true, vigiaConflitos: 1 });
    expect(body.conflitoQuoteIds).toBeUndefined(); // só contagens na resposta
    expect(m.alerta).toHaveBeenCalledOnce();
    const mail = m.alerta.mock.calls[0][0];
    expect(mail.assunto).toMatch(/emissão dupla/);
    expect(mail.linhas.join('\n')).toContain('quote: q_dup');
  });

  it('e-mail ENTREGUE → grava a marca de dedupe dos conflitos alertados', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 2, conflitoQuoteIds: ['q_a', 'q_b'] });
    await GET(req(`Bearer ${SECRET}`));
    expect(m.marcar).toHaveBeenCalledWith(['q_a', 'q_b']);
  });

  it('SMTP FALHA → a marca NÃO é gravada (a próxima varredura alerta de novo); a rota não cai e alerta fica true', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    m.alerta.mockResolvedValue(false);
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ alerta: true, alertaEnviado: false });
    expect(m.marcar).not.toHaveBeenCalled();
  });

  it('simula duas varreduras seguidas: SMTP falha na 1ª (sem marca), entrega na 2ª (com marca) — o aviso não se perde', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    m.alerta.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await GET(req(`Bearer ${SECRET}`));
    expect(m.marcar).not.toHaveBeenCalled();
    await GET(req(`Bearer ${SECRET}`));
    expect(m.alerta).toHaveBeenCalledTimes(2);
    expect(m.marcar).toHaveBeenCalledOnce();
    expect(m.marcar).toHaveBeenCalledWith(['q_dup']);
  });

  it('falha ao gravar a marca depois do e-mail entregue não derruba a rota (pior caso: um e-mail repetido)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaConflitos: 1, conflitoQuoteIds: ['q_dup'] });
    m.marcar.mockRejectedValue(new Error('db fora'));
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ alerta: true, alertaEnviado: true });
  });

  it('sem header, com secret errado, sem o prefixo Bearer ou de tamanho diferente → 404, sem reconciliar', async () => {
    for (const auth of [undefined, 'Bearer errado', SECRET, 'Bearer ', `Bearer ${SECRET}x`, `Basic ${SECRET}`]) {
      const r = await GET(req(auth));
      expect(r.status, String(auth)).toBe(404);
    }
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('OPS_CRON_SECRET fraco (< 32 caracteres após o trim) = não configurado: 404 mesmo com o Bearer "certo"', async () => {
    for (const fraco of ['a', 'abcd', 'x'.repeat(31), `  ${'x'.repeat(31)}  `]) {
      process.env.OPS_CRON_SECRET = fraco;
      expect((await GET(req(`Bearer ${fraco.trim()}`))).status, JSON.stringify(fraco)).toBe(404);
    }
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('32 caracteres certos autorizam (e o trim do valor configurado é respeitado)', async () => {
    const forte = 'k'.repeat(32);
    process.env.OPS_CRON_SECRET = forte;
    expect((await GET(req(`Bearer ${forte}`))).status).toBe(200);
    process.env.OPS_CRON_SECRET = `  ${forte}  `;
    expect((await GET(req(`Bearer ${forte}`))).status).toBe(200);
    expect((await GET(req(`Bearer ${'k'.repeat(31)}j`))).status).toBe(404); // 32 chars, mas errado
  });

  it('conflito novo na vigia de RESGATE: e-mail próprio, marca só depois de entregue, alerta true, ids fora da resposta', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, resgatesVigiaConflitos: 1, conflitoResgateIds: ['r_dup'] });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: true, resgatesVigiaConflitos: 1 });
    expect(body.conflitoResgateIds).toBeUndefined();
    expect(m.alerta).toHaveBeenCalledOnce();
    expect(JSON.stringify(m.alerta.mock.calls[0][0])).toContain('r_dup');
    expect(m.marcarResgate).toHaveBeenCalledWith(['r_dup']);
    expect(m.marcar).not.toHaveBeenCalled();
  });

  it('e-mail do conflito de resgate NÃO entregue: não marca (a próxima varredura alerta de novo) e alerta segue true', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, resgatesVigiaConflitos: 1, conflitoResgateIds: ['r_dup'] });
    m.alerta.mockResolvedValue(false);
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: false });
    expect(m.marcarResgate).not.toHaveBeenCalled();
  });

  it('resgate órfão SEM prova (resgatesSemProva > 0) liga alerta, sem e-mail de conflito (o job do agendador falha)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, resgatesSemProva: 2 });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: false, resgatesSemProva: 2 });
    expect(m.alerta).not.toHaveBeenCalled();
  });

  it('swap órfão SEM prova (vencidasSemProva > 0) também liga alerta (fecha o NAV; o job falha)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vencidasSemProva: 1, resgatesSemProva: 0 });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, alertaEnviado: false, vencidasSemProva: 1 });
    expect(m.alerta).not.toHaveBeenCalled();
  });

  it.each([['VENCIDA'], ['AUSENTE']])('referência de preço %s → alerta:true (todo resgate é recusado), só o estado na resposta', async (status) => {
    m.ref.mockResolvedValue({ status, preco: '1.2345' });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ alerta: true, referenciaPreco: status });
    expect(JSON.stringify(body)).not.toContain('1.2345');
  });

  it('falha ao ler a referência → INDISPONIVEL e alerta:true (o job não pode ficar verde sem saber)', async () => {
    m.ref.mockRejectedValue(new Error('db fora'));
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ alerta: true, referenciaPreco: 'INDISPONIVEL' });
  });

  it('a resposta traz vigiaRestantes (só contagem)', async () => {
    m.reconciliar.mockResolvedValue({ ...RESULTADO, vigiaRestantes: 70 });
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body.vigiaRestantes).toBe(70);
  });

  it('sem OPS_CRON_SECRET configurado a rota não existe (404), mesmo com um Bearer qualquer', async () => {
    delete process.env.OPS_CRON_SECRET;
    expect((await GET(req('Bearer qualquer'))).status).toBe(404);
    expect((await GET(req('Bearer '))).status).toBe(404);
    expect(m.reconciliar).not.toHaveBeenCalled();
  });

  it('rate limit estourado → 429 ANTES de olhar o secret, sem reconciliar', async () => {
    m.consume.mockResolvedValue(false);
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(429);
    expect(m.reconciliar).not.toHaveBeenCalled();
    expect(m.consume).toHaveBeenCalledWith('203.0.113.9');
  });

  it('erro interno → 500 fixo, sem vazar a causa', async () => {
    m.reconciliar.mockRejectedValue(new Error('postgresql://u:SEGREDO@db/x'));
    const r = await GET(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('SEGREDO');
  });
});
