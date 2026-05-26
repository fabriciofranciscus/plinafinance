/**
 * Envelope `{ data, error: { code, message, requestId } }` + withApi.
 *
 * Cobre:
 *   - ok()/fail() shape correto
 *   - withApi gera requestId + propaga via x-request-id
 *   - withApi captura ApiError, ZodError, AuthError (compat com auth-guard
 *     existente) e Error genérico
 *   - INTERNAL não vaza mensagem original (defesa contra leak)
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ok, fail } from '@/lib/api/response';
import { ApiError } from '@/lib/api/errors';
import { withApi } from '@/lib/api/with-api';
import { AuthError } from '@/lib/wallet/auth-guard';

describe('response envelope', () => {
  it('ok() returns { data, error: null } + x-request-id', async () => {
    const res = ok({ x: 1 }, { requestId: 'req-1' });
    const body = await res.json();
    expect(body).toEqual({ data: { x: 1 }, error: null });
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(res.status).toBe(200);
  });

  it('ok() accepts custom status', async () => {
    const res = ok({ created: true }, { status: 201, requestId: 'req-2' });
    expect(res.status).toBe(201);
  });

  it('fail() returns { data: null, error: { code, message, requestId } }', async () => {
    const res = fail('UNAUTHORIZED', 'no token', 401, 'req-3');
    const body = await res.json();
    expect(body).toEqual({
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'no token', requestId: 'req-3' },
    });
    expect(res.headers.get('x-request-id')).toBe('req-3');
    expect(res.status).toBe(401);
  });
});

describe('withApi wrapper', () => {
  it('gera requestId e expõe via x-request-id header em sucesso', async () => {
    const handler = withApi(async (_req, { requestId }) => ok({ rid: requestId }));
    const res = await handler(new Request('http://t/x'));
    const rid = res.headers.get('x-request-id');
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body.data.rid).toBe(rid);
  });

  it('captura ApiError e mapeia pra envelope', async () => {
    const handler = withApi(async () => {
      throw new ApiError('NOT_FOUND', 404, 'no such cota');
    });
    const res = await handler(new Request('http://t/x'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('no such cota');
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data).toBeNull();
  });

  it('captura AuthError (auth-guard existente) e mapeia 401 → UNAUTHORIZED', async () => {
    const handler = withApi(async () => {
      throw new AuthError('token Privy ausente', 401);
    });
    const res = await handler(new Request('http://t/x'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('token Privy ausente');
  });

  it('captura AuthError 403 → FORBIDDEN', async () => {
    const handler = withApi(async () => {
      throw new AuthError('investidor não onboardado', 403);
    });
    const res = await handler(new Request('http://t/x'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('captura ZodError e mapeia pra VALIDATION_FAILED 400', async () => {
    const schema = z.object({ name: z.string() });
    const handler = withApi(async () => {
      schema.parse({ name: 123 });
      return ok({});
    });
    const res = await handler(new Request('http://t/x'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBeTypeOf('string');
  });

  it('Error genérico vira INTERNAL 500 sem vazar mensagem original', async () => {
    const handler = withApi(async () => {
      throw new Error('database connection string leaked here');
    });
    const res = await handler(new Request('http://t/x'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('unexpected error');
    expect(body.error.message).not.toContain('database');
  });
});
