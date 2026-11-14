import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('botid/server', () => ({ checkBotId: m.check }));

import { botIdAtivo, requisicaoEhBot } from '@/lib/http/botid';

beforeEach(() => {
  m.check.mockReset().mockResolvedValue({ isBot: false });
  delete process.env.BOTID_ENFORCE;
});
afterEach(() => {
  delete process.env.BOTID_ENFORCE;
});

describe('botIdAtivo: só o valor EXATO "false" desliga (fail-closed)', () => {
  it('ausente, vazio, true e variações de "false" continuam checando', () => {
    for (const v of [undefined, '', 'true', 'FALSE', 'False', ' false', 'false ', '0', 'no', 'off', 'false\n']) {
      expect(botIdAtivo(v)).toBe(true);
    }
  });
  it("'false' exato desliga", () => {
    expect(botIdAtivo('false')).toBe(false);
  });
  it('lê process.env.BOTID_ENFORCE por padrão', () => {
    expect(botIdAtivo()).toBe(true);
    process.env.BOTID_ENFORCE = 'false';
    expect(botIdAtivo()).toBe(false);
  });
});

describe('requisicaoEhBot (usada só por /api/vender/lead)', () => {
  it('flag ausente: chama o BotID (com o host www permitido) e devolve o veredito', async () => {
    m.check.mockResolvedValue({ isBot: true });
    expect(await requisicaoEhBot()).toBe(true);
    expect(m.check).toHaveBeenCalledWith({ advancedOptions: { extraAllowedHosts: ['www.plina.finance'] } });
    m.check.mockResolvedValue({ isBot: false });
    expect(await requisicaoEhBot()).toBe(false);
  });
  it("BOTID_ENFORCE='false': NÃO chama o BotID e não classifica como bot (mesmo que ele diria que é)", async () => {
    process.env.BOTID_ENFORCE = 'false';
    m.check.mockResolvedValue({ isBot: true });
    expect(await requisicaoEhBot()).toBe(false);
    expect(m.check).not.toHaveBeenCalled();
  });
  it('valor diferente de "false" (ex.: "FALSE", "0") continua checando', async () => {
    m.check.mockResolvedValue({ isBot: true });
    for (const v of ['FALSE', '0', ' false']) {
      process.env.BOTID_ENFORCE = v;
      expect(await requisicaoEhBot()).toBe(true);
    }
  });
});
