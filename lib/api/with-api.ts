/**
 * Wrapper de route handler. Cria requestId, captura erros conhecidos e
 * mapeia pro envelope `{ data, error }`.
 *
 * Uso (rota pública):
 *
 *   export const GET = withApi(async (_req, { requestId }) => {
 *     const data = await someService();
 *     return ok(data, { requestId });
 *   });
 *
 * Uso (rota autenticada com auth-guard existente):
 *
 *   export const POST = withApi(async (req, { requestId }) => {
 *     const user = await requireInvestidor(req); // throws AuthError
 *     const body = mySchema.parse(await req.json()); // throws ZodError
 *     ...
 *     return ok(result, { requestId });
 *   });
 *
 * Erros tratados (em ordem de captura):
 *   - `ApiError`     → fail(err.code, err.message, err.status, requestId)
 *   - `AuthError`    → fail('UNAUTHORIZED'|'FORBIDDEN', err.message, err.status, requestId)
 *                      (compat com `lib/wallet/auth-guard`)
 *   - `ZodError`     → fail('VALIDATION_FAILED', issues..., 400, requestId)
 *   - genérico       → fail('INTERNAL', 'unexpected error', 500, requestId)
 *                      (mensagem original loga server-side, NUNCA volta pro cliente)
 *
 * Handler interno DEVE chamar `ok(...)`. Pra responses cruas (redirects 303),
 * retorne `NextResponse` direto — wrapper só anexa `x-request-id`.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './errors';
import { fail } from './response';
import { AuthError } from '@/lib/wallet/auth-guard';

export interface ApiContext {
  requestId: string;
}

type Handler<R extends NextResponse = NextResponse> = (
  req: Request,
  ctx: ApiContext,
) => Promise<R>;

export function withApi<R extends NextResponse>(
  handler: Handler<R>,
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    const requestId = crypto.randomUUID();
    try {
      const res = await handler(req, { requestId });
      if (!res.headers.has('x-request-id')) {
        res.headers.set('x-request-id', requestId);
      }
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.code, err.message, err.status, requestId);
      }
      if (err instanceof AuthError) {
        const code = err.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED';
        return fail(code, err.message, err.status, requestId);
      }
      if (err instanceof ZodError) {
        const message = err.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        return fail('VALIDATION_FAILED', message, 400, requestId);
      }
      console.error(`[api ${requestId}]`, err);
      return fail('INTERNAL', 'unexpected error', 500, requestId);
    }
  };
}
