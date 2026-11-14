import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** QA Vera — hotfix BotID (fix/botid-flag): o que os testes do dev não cobrem. */
const m = vi.hoisted(() => ({ checkBotId: vi.fn(), consume: vi.fn(), capturar: vi.fn() }));
vi.mock('botid/server', () => ({ checkBotId: m.checkBotId }));
vi.mock('@/lib/rate-limit/config', () => ({ leadLimiter: { consume: m.consume }, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/services/originacao', () => ({ capturarLead: m.capturar }));

import { POST as venderPOST } from '@/app/api/vender/lead/route';
import { botIdProtegidos } from '@/lib/http/botid-rotas';
import { botIdAtivo } from '@/lib/http/botid';

const lerFonte = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const req = (headers: Record<string, string> = {}) =>
  new Request('http://x/api/vender/lead', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ consentimentoLgpd: true }) });

beforeEach(() => {
  delete process.env.BOTID_ENFORCE;
  m.checkBotId.mockReset().mockResolvedValue({ isBot: true });
  m.consume.mockReset().mockResolvedValue(true);
  m.capturar.mockReset();
});

describe('o cliente: os DOIS pontos de registro do BotID usam a MESMA regra', () => {
  it('instrumentation-client.ts não pode ter a lista fixa com /api/vender/lead: tem de usar botIdProtegidos(NEXT_PUBLIC_BOTID_ENFORCE) (senão a flag "false" não desliga o desafio que prende o POST)', () => {
    const f = lerFonte('instrumentation-client.ts');
    expect(f).toContain('botIdProtegidos');
    expect(f).toContain('NEXT_PUBLIC_BOTID_ENFORCE');
    expect(f).not.toMatch(/path:\s*['"]\/api\/vender\/lead['"]/);
  });
  it('layout.tsx e instrumentation-client.ts chamam a função com a MESMA variável pública', () => {
    for (const rel of ['app/layout.tsx', 'instrumentation-client.ts']) {
      expect(lerFonte(rel), rel).toMatch(/botIdProtegidos\(\s*process\.env\.NEXT_PUBLIC_BOTID_ENFORCE\s*\)/);
    }
  });
  it('a lista do cliente: /api/comprar/lead SEMPRE (qualquer valor da flag, inclusive "false"); /api/vender/lead só se a flag não é "false" exato', () => {
    for (const v of [undefined, '', 'true', 'FALSE', ' false', 'false ', '0', 'no']) {
      expect(botIdProtegidos(v).map((r) => r.path).sort(), String(v)).toEqual(['/api/comprar/lead', '/api/vender/lead']);
    }
    expect(botIdProtegidos('false').map((r) => r.path)).toEqual(['/api/comprar/lead']);
    expect(botIdProtegidos('false').every((r) => r.method === 'POST')).toBe(true);
  });
  it('lib/http/botid-rotas.ts não importa nada de servidor (é importado no bundle do cliente)', () => {
    const f = lerFonte('lib/http/botid-rotas.ts');
    expect(f).not.toMatch(/from\s+['"]botid\/server['"]/);
    expect(f).not.toMatch(/process\.env/);
  });
});

describe('o servidor: as duas rotas e o login', () => {
  it('as variáveis do servidor e do cliente são INDEPENDENTES: BOTID_ENFORCE não afeta a lista do cliente e NEXT_PUBLIC_BOTID_ENFORCE não afeta o servidor', () => {
    process.env.BOTID_ENFORCE = 'false';
    expect(botIdProtegidos(undefined)).toHaveLength(2);
    delete process.env.BOTID_ENFORCE;
    process.env.NEXT_PUBLIC_BOTID_ENFORCE = 'false';
    expect(botIdAtivo()).toBe(true);
    delete process.env.NEXT_PUBLIC_BOTID_ENFORCE;
  });
  it("com BOTID_ENFORCE='false' o /api/vender/lead continua EXIGINDO login (sem credencial → 401/403, nunca 200) e não chega ao BotID, ao limiter nem ao serviço", async () => {
    process.env.BOTID_ENFORCE = 'false';
    const r = await venderPOST(req());
    expect([401, 403]).toContain(r.status);
    expect(m.capturar).not.toHaveBeenCalled();
    expect(m.consume).not.toHaveBeenCalled();
  });
  it('a rota do /comprar/lead é idêntica a 2f01001 e usa checkBotId direto (não a flag)', () => {
    const f = lerFonte('app/api/comprar/lead/route.ts');
    expect(f).toContain("from 'botid/server'");
    expect(f).not.toMatch(/requisicaoEhBot|BOTID_ENFORCE|botIdAtivo/);
  });
  it('só a rota do /vender/lead USA a flag do servidor (import de requisicaoEhBot / leitura de process.env.BOTID_ENFORCE): nenhuma outra rota nem lib', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const raiz = new URL('../../../', import.meta.url).pathname;
    const usos = execSync("grep -rlE \"requisicaoEhBot|process\\.env\\.BOTID_ENFORCE|botIdAtivo\" app lib components instrumentation-client.ts --include=*.ts --include=*.tsx || true", { cwd: raiz, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).sort();
    expect(usos).toEqual(['app/api/vender/lead/route.ts', 'lib/http/botid.ts']);
  });
});
