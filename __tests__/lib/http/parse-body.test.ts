import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseBody } from '@/lib/http/parse-body';

const Schema = z
  .object({
    name: z.string().min(1),
    age: z.number().int().nonnegative(),
  })
  .strict();

function req(body: string): Request {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('parseBody — C-06', () => {
  it('200 happy: shape válido', async () => {
    const r = await parseBody(req(JSON.stringify({ name: 'X', age: 30 })), Schema);
    expect('data' in r).toBe(true);
    if ('data' in r) expect(r.data.name).toBe('X');
  });

  it('400 quando JSON inválido', async () => {
    const r = await parseBody(req('not-json'), Schema);
    expect('response' in r).toBe(true);
    if ('response' in r) expect(r.response.status).toBe(400);
  });

  it('400 quando campo errado', async () => {
    const r = await parseBody(
      req(JSON.stringify({ name: 'X', age: -1 })),
      Schema,
    );
    expect('response' in r).toBe(true);
    if ('response' in r) {
      const json = await r.response.json();
      expect(json.error).toMatch(/inválido/);
      expect(json.issues[0].path).toBe('age');
    }
  });

  it('400 com keys desconhecidas (strict)', async () => {
    const r = await parseBody(
      req(JSON.stringify({ name: 'X', age: 1, extra: 'evil' })),
      Schema,
    );
    expect('response' in r).toBe(true);
  });

  it('400 quando body é array em vez de objeto', async () => {
    const r = await parseBody(req(JSON.stringify([])), Schema);
    expect('response' in r).toBe(true);
  });
});
