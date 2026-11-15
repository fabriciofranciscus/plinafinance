import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carregarEnv } from '../../scripts/lib/carregar-env';

const CHAVES = ['ENV_TESTE_A13_BANCO', 'ENV_TESTE_A13_SO_LOCAL', 'ENV_TESTE_A13_SO_ENV'];
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carregar-env-'));
  for (const k of CHAVES) delete process.env[k];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of CHAVES) delete process.env[k];
});
const escrever = (nome: string, linhas: string[]) => writeFileSync(join(dir, nome), linhas.join('\n'));

describe('carregarEnv (A-13): linha de comando > .env.local > .env', () => {
  it('a variável da linha de comando/shell NÃO é sobrescrita pelo .env.local nem pelo .env', () => {
    process.env.ENV_TESTE_A13_BANCO = 'banco-da-linha-de-comando';
    escrever('.env.local', ['ENV_TESTE_A13_BANCO=banco-do-env-local']);
    escrever('.env', ['ENV_TESTE_A13_BANCO=banco-do-env']);
    carregarEnv(dir);
    expect(process.env.ENV_TESTE_A13_BANCO).toBe('banco-da-linha-de-comando');
  });
  it('sem variável no shell, o .env.local vence o .env', () => {
    escrever('.env.local', ['ENV_TESTE_A13_BANCO=banco-do-env-local']);
    escrever('.env', ['ENV_TESTE_A13_BANCO=banco-do-env']);
    carregarEnv(dir);
    expect(process.env.ENV_TESTE_A13_BANCO).toBe('banco-do-env-local');
  });
  it('cada arquivo ainda fornece o que o outro não tem', () => {
    escrever('.env.local', ['ENV_TESTE_A13_SO_LOCAL=l']);
    escrever('.env', ['ENV_TESTE_A13_SO_ENV=e']);
    carregarEnv(dir);
    expect(process.env.ENV_TESTE_A13_SO_LOCAL).toBe('l');
    expect(process.env.ENV_TESTE_A13_SO_ENV).toBe('e');
  });
  it('arquivos ausentes não quebram', () => {
    expect(() => carregarEnv(dir)).not.toThrow();
  });
});

describe('nenhum script volta a sobrescrever o ambiente com .env.local', () => {
  it('não há `override: true` de dotenv em scripts/ nem em prisma/seed.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const achados: string[] = [];
    // Só código: comentários podem explicar o `override: true` antigo.
    const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const varre = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) varre(p);
        else if (/\.(ts|mjs|cjs|js)$/.test(n) && /override:\s*true/.test(semComentarios(readFileSync(p, 'utf8')))) achados.push(p);
      }
    };
    varre('scripts');
    if (/override:\s*true/.test(semComentarios(readFileSync('prisma/seed.ts', 'utf8')))) achados.push('prisma/seed.ts');
    expect(achados).toEqual([]);
  });
});
