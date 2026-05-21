#!/usr/bin/env node
/**
 * Lint: garante que toda rota em `app/api/investidor/**` importa
 * `@/lib/wallet/auth-guard`. Allowlist explícita pra `onboard` (cria o
 * Investidor, então não pode resolver via guard) e `events` (continua
 * usando withAuth no PR 2 mas já cobre via marker).
 *
 * Roda em `prebuild` — bloqueia deploy se regressão entrar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api/investidor';
const ALLOWLIST = new Set(['onboard']);
const MARKER = '@/lib/wallet/auth-guard';

function* routeFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* routeFiles(p);
    else if (name === 'route.ts') yield p;
  }
}

const failures = [];
let checked = 0;
for (const file of routeFiles(ROOT)) {
  const rel = file.replace(`${ROOT}/`, '').replace(/\/route\.ts$/, '');
  const top = rel.split('/')[0];
  if (ALLOWLIST.has(top)) continue;
  checked++;
  const src = readFileSync(file, 'utf8');
  if (!src.includes(MARKER)) failures.push(file);
}

if (failures.length) {
  console.error('\n❌ Rotas em app/api/investidor/** sem auth-guard:\n');
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(
    '\nImporte `withAuth` ou `requireInvestidor` de @/lib/wallet/auth-guard.\n' +
      'Allowlist atual: ' +
      [...ALLOWLIST].join(', ') +
      '\n',
  );
  process.exit(1);
}

console.log(
  `✓ ${ROOT}: ${checked} rota(s) verificada(s), todas usam auth-guard.`,
);
