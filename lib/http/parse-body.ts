/**
 * Parse + validação de body JSON com Zod (C-06).
 *
 * Substitui o pattern `(await req.json()) as { x?: string }` que aceita
 * qualquer shape (array onde esperava string, objeto onde esperava
 * número, `__proto__` injection). Zod v4 com `.strict()` rejeita keys
 * desconhecidas e tipos errados.
 *
 * Devolve o valor parseado em sucesso, ou uma NextResponse 400 com
 * detalhes pro caller passar adiante. Não logga — caller decide se é
 * reconnaissance ou erro real.
 */
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      response: NextResponse.json(
        { error: 'body deve ser JSON válido' },
        { status: 400 },
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        {
          error: 'body inválido',
          issues: flattenIssues(parsed.error),
        },
        { status: 400 },
      ),
    };
  }
  return { data: parsed.data };
}

function flattenIssues(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    message: i.message,
  }));
}
