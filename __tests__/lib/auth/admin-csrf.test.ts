import { describe, it, expect } from 'vitest';
import { requireAdminCsrf } from '@/lib/auth/admin-csrf';

function req(headers: Record<string, string>): Request {
  return new Request('https://plina.app/api/admin/foo', {
    method: 'POST',
    headers,
  });
}

describe('requireAdminCsrf — N-10/N-11', () => {
  it('403 sem header x-plina-admin', () => {
    const r = requireAdminCsrf(req({}));
    expect(r?.status).toBe(403);
  });

  it('403 com header errado', () => {
    const r = requireAdminCsrf(req({ 'x-plina-admin': '0' }));
    expect(r?.status).toBe(403);
  });

  it('null (passa) com header correto + origin same-host', () => {
    const r = requireAdminCsrf(
      req({
        'x-plina-admin': '1',
        origin: 'https://plina.app',
      }),
    );
    expect(r).toBeNull();
  });

  it('null (passa) com header + sem origin/referer (same-origin XHR)', () => {
    const r = requireAdminCsrf(req({ 'x-plina-admin': '1' }));
    expect(r).toBeNull();
  });

  it('403 com header + origin cross-host', () => {
    const r = requireAdminCsrf(
      req({
        'x-plina-admin': '1',
        origin: 'https://attacker.com',
      }),
    );
    expect(r?.status).toBe(403);
  });

  it('null (passa) com referer same-host (fallback)', () => {
    const r = requireAdminCsrf(
      req({
        'x-plina-admin': '1',
        referer: 'https://plina.app/admin',
      }),
    );
    expect(r).toBeNull();
  });

  it('403 com referer inválido', () => {
    const r = requireAdminCsrf(
      req({
        'x-plina-admin': '1',
        referer: 'not-a-url',
      }),
    );
    expect(r?.status).toBe(403);
  });
});
