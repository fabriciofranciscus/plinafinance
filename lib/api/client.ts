/**
 * Client de fetch que entende o envelope `{ data, error }` da API.
 *
 * Sucesso: retorna `data` direto.
 * Falha: throws `ApiClientError` com `code` machine-readable e `requestId`
 *        propagado (body.error.requestId ou header `x-request-id`).
 *
 * Mobile (React Native) consumirá o mesmo módulo trocando só o `baseUrl`
 * implícito (`fetch` global).
 *
 * Coexiste com handlers que ainda retornam shape antigo `{ error: string }` —
 * nesse caso, o fallback joga `ApiClientError('LEGACY_ERROR', text, ...)`.
 */

import type { ApiErrorCode } from './errors';

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode | string,
    message: string,
    public readonly requestId: string | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  /** Privy access token (`getAccessToken()`). Setado como `Authorization: Bearer`. */
  token?: string;
  /** JSON body — serializado automaticamente. Para multipart, use `RequestInit.body` direto via `as`. */
  json?: unknown;
}

export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const { token, json, headers, ...rest } = init;

  const finalHeaders: Record<string, string> = {
    ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers as Record<string, string> | undefined),
  };

  const res = await fetch(path, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError(
      'INTERNAL',
      `resposta não-JSON (status ${res.status})`,
      res.headers.get('x-request-id'),
      res.status,
    );
  }

  // Envelope (novo). Sempre tem `data` e `error` (um deles null).
  if (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    'error' in body
  ) {
    const env = body as {
      data: T | null;
      error: { code: string; message: string; requestId: string } | null;
    };
    if (env.error) {
      throw new ApiClientError(
        env.error.code,
        env.error.message,
        env.error.requestId,
        res.status,
      );
    }
    return env.data as T;
  }

  // Legacy shape `{ error: string }` ou `{ ...payload }` cru.
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiClientError(
      'LEGACY_ERROR',
      message,
      res.headers.get('x-request-id'),
      res.status,
    );
  }
  return body as T;
}
