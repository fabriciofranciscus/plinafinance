/**
 * Envelope de resposta uniforme pra `app/api/`.
 *
 * Sucesso:   { data: T,    error: null }
 * Falha:     { data: null, error: { code, message, requestId } }
 *
 * Status HTTP carrega semântica (200/201/4xx/5xx). `error.code` é
 * machine-readable; cliente discrimina por ele, não pelo texto.
 * `error.requestId` (UUID) é também propagado no header `x-request-id`
 * pra correlação com logs do servidor.
 *
 * Coexiste com handlers que ainda retornam `NextResponse.json` cru — a
 * adoção é incremental, rota a rota.
 */

import { NextResponse } from 'next/server';
import type { ApiErrorCode } from './errors';

export interface ApiOk<T> {
  data: T;
  error: null;
}

export interface ApiErr {
  data: null;
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function ok<T>(
  data: T,
  init?: { status?: number; requestId?: string },
): NextResponse<ApiOk<T>> {
  const res = NextResponse.json<ApiOk<T>>(
    { data, error: null },
    { status: init?.status ?? 200 },
  );
  if (init?.requestId) {
    res.headers.set('x-request-id', init.requestId);
  }
  return res;
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
): NextResponse<ApiErr> {
  const res = NextResponse.json<ApiErr>(
    { data: null, error: { code, message, requestId } },
    { status },
  );
  res.headers.set('x-request-id', requestId);
  return res;
}
