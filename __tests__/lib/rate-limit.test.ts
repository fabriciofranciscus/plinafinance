import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter, clientIp } from '@/lib/rate-limit/in-memory';

describe('createRateLimiter', () => {
  afterEach(() => vi.useRealTimers());

  it('permite até o limite e bloqueia depois', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(false);
  });

  it('IPs distintos não interferem', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('b')).toBe(true);
    expect(rl.consume('a')).toBe(false);
  });

  it('recupera após a janela expirar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('a')).toBe(false);
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    expect(rl.consume('a')).toBe(true);
  });

  it('reset zera contador da chave', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    rl.consume('a');
    rl.reset('a');
    expect(rl.consume('a')).toBe(true);
  });
});

describe('clientIp', () => {
  it('extrai primeiro IP de x-forwarded-for', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('fallback x-real-ip', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });

  it('fallback unknown', () => {
    const req = new Request('http://x');
    expect(clientIp(req)).toBe('unknown');
  });
});
