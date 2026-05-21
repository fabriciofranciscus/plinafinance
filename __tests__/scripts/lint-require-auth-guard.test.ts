import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

const SCRIPT = resolve('scripts/lint/require-auth-guard.mjs');

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'plina-lint-'));
  mkdirSync(join(dir, 'app/api/investidor/foo'), { recursive: true });
  mkdirSync(join(dir, 'app/api/investidor/onboard'), { recursive: true });
  return dir;
}

function run(cwd: string): { code: number; output: string } {
  try {
    const stdout = execSync(`node ${SCRIPT}`, { cwd, encoding: 'utf8' });
    return { code: 0, output: stdout };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return {
      code: e.status,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    };
  }
}

describe('lint:auth-guard', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
  });

  it('passa quando rota importa @/lib/wallet/auth-guard', () => {
    const dir = makeTempProject();
    cleanup.push(dir);
    writeFileSync(
      join(dir, 'app/api/investidor/foo/route.ts'),
      "import { withAuth } from '@/lib/wallet/auth-guard';\nexport const POST = withAuth(async () => new Response());",
    );
    writeFileSync(join(dir, 'app/api/investidor/onboard/route.ts'), 'export const POST = async () => new Response();');
    const r = run(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain('todas usam auth-guard');
  });

  it('falha quando rota nova esquece o guard', () => {
    const dir = makeTempProject();
    cleanup.push(dir);
    writeFileSync(
      join(dir, 'app/api/investidor/foo/route.ts'),
      'export const POST = async () => new Response();',
    );
    writeFileSync(join(dir, 'app/api/investidor/onboard/route.ts'), 'export const POST = async () => new Response();');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('sem auth-guard');
    expect(r.output).toContain('foo/route.ts');
  });
});
