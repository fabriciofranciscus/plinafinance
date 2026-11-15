import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botIdProtegidos } from '@/lib/http/botid-rotas';

describe('botIdProtegidos (cliente): /comprar/lead SEMPRE; /vender/lead só sem a flag exata "false"', () => {
  const COMPRAR = { path: '/api/comprar/lead', method: 'POST' };
  const VENDER = { path: '/api/vender/lead', method: 'POST' };

  it('flag ausente, vazia ou diferente de "false": as DUAS rotas protegidas (fail-closed)', () => {
    for (const v of [undefined, '', 'true', 'FALSE', ' false', 'false ', '0', 'off']) {
      expect(botIdProtegidos(v)).toEqual([VENDER, COMPRAR]);
    }
  });

  it('flag "false" exata: só /api/comprar/lead segue protegida', () => {
    expect(botIdProtegidos('false')).toEqual([COMPRAR]);
  });
});

/**
 * O BotID do CLIENTE tem dois pontos (Vera, 14/11): `BotIdClient` no layout e `initBotId` no instrumentation-client. Teste de
 * deriva sobre o fonte (o layout é um server component async, caro de renderizar aqui).
 */
describe('layout: BotIdClient usa a lista com a flag', () => {
  const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

  it('renderiza em produção com protect = botIdProtegidos(NEXT_PUBLIC_BOTID_ENFORCE)', () => {
    expect(layout).toMatch(/process\.env\.NODE_ENV === "production" && \(\s*<BotIdClient protect=\{botIdProtegidos\(process\.env\.NEXT_PUBLIC_BOTID_ENFORCE\)\} \/>/);
  });

  it('há uma só renderização do BotIdClient e nenhuma lista fixa com o path de vender', () => {
    expect(layout.match(/<BotIdClient/g)).toHaveLength(1);
    expect(layout).not.toMatch(/path: "\/api\/vender\/lead"/);
  });
});

describe('instrumentation-client: initBotId usa a MESMA lista do layout', () => {
  const inst = readFileSync(join(process.cwd(), 'instrumentation-client.ts'), 'utf8');

  it('protect = botIdProtegidos(NEXT_PUBLIC_BOTID_ENFORCE), sem paths fixos', () => {
    expect(inst).toMatch(/initBotId\(\{ protect: botIdProtegidos\(process\.env\.NEXT_PUBLIC_BOTID_ENFORCE\) \}\)/);
    expect(inst).not.toMatch(/path: '\/api\/(vender|comprar)\/lead'/);
    expect(inst).toMatch(/from '@\/lib\/http\/botid-rotas'/);
  });

  it('com a flag "false" o registro do cliente chama initBotId só com /comprar/lead; sem flag, com as duas', async () => {
    const { vi } = await import('vitest');
    const chamadas: unknown[] = [];
    vi.resetModules();
    vi.doMock('botid/client/core', () => ({ initBotId: (o: unknown) => chamadas.push(o) }));
    process.env.NEXT_PUBLIC_BOTID_ENFORCE = 'false';
    await import('../../../instrumentation-client');
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_BOTID_ENFORCE;
    await import('../../../instrumentation-client');
    vi.doUnmock('botid/client/core');
    expect(chamadas).toEqual([
      { protect: [{ path: '/api/comprar/lead', method: 'POST' }] },
      { protect: [{ path: '/api/vender/lead', method: 'POST' }, { path: '/api/comprar/lead', method: 'POST' }] },
    ]);
  });
});
