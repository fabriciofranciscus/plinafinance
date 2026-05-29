import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('getTransporter', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('null sem SMTP configurado (no-op em dev/test)', async () => {
    const { getTransporter } = await import('@/lib/email/transporter');
    expect(getTransporter()).toBeNull();
  });

  it('cria transporter quando SMTP presente', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'u@example.com';
    process.env.SMTP_PASS = 'secret';
    const { getTransporter } = await import('@/lib/email/transporter');
    expect(getTransporter()).not.toBeNull();
  });
});
