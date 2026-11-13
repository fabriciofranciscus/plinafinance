#!/usr/bin/env node
/**
 * Lint: garante que toda rota em `app/api/**` importa um guard de auth.
 *
 * Cada árvore mutante usa um guard diferente, então reconhecemos os três
 * módulos (`MARKERS`). Rota sem nenhum guard só passa se estiver na allowlist
 * explícita `PUBLIC_ROUTES` (por caminho completo, com justificativa) — isso
 * impede regressão silenciosa em qualquer árvore (comprar/vender/conta/admin/…),
 * não só investidor, que foi exatamente como buracos de auth passaram no CI.
 *
 * Heurística é presença de import (substring), não AST: um `route.ts` com dois
 * handlers onde só um é guardado passaria, e `admin/logout` casa via
 * `@/lib/auth/admin` (clearAdminCookie, que não é guard) — aceitável porque
 * também importa `admin-csrf`. Endurecer pra nível de método é follow-up.
 *
 * Roda em `prebuild` — bloqueia deploy se regressão entrar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api';

// Rota é "guardada" se importa QUALQUER um destes módulos.
const MARKERS = [
  '@/lib/wallet/auth-guard', // withAuth / requireInvestidor
  '@/lib/wallet/pessoa-auth', // withPessoaAuth / requirePessoa
  '@/lib/auth/admin', // isAdminAuthenticated (admin/* importa este)
  '@/lib/auth/admin-csrf', // requireAdminCsrf (admin/logout)
  '@/lib/auth/ops-cron', // requireOpsCron: Bearer OPS_CRON_SECRET (404 sem ele) — ops/*
];

// Públicas por design — sem guard, intencional. Chave = caminho relativo a
// `app/api` sem `/route.ts`. Valor = justificativa (impressa no resumo).
const PUBLIC_ROUTES = new Map([
  ['investidor/onboard', 'signup — valida token Privy no handler'],
  ['comprar/lead', 'captação de lead — BotID + rate-limit'],
  ['vender/simular', 'simulador read-only, sem persistência'],
  ['webhooks/anchor', 'webhook — autenticado por assinatura HMAC (X-Signature), dedupe por eventoId'],
  ['pool/summary', 'agregados públicos read-only'],
  ['nav-snapshot/[data]', 'arquivo público do snapshot do NAV (E3-1): read-only, sem PII, rate-limit, só serve se o SHA-256 bate com o ancorado'],
  ['comprovante/[cessaoId]', 'recibo — cessaoId é bearer token na URL'],
]);

function* routeFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* routeFiles(p);
    else if (name === 'route.ts') yield p;
  }
}

const failures = [];
const skipped = [];
let checked = 0;
for (const file of routeFiles(ROOT)) {
  const rel = file.replace(`${ROOT}/`, '').replace(/\/route\.ts$/, '');
  if (PUBLIC_ROUTES.has(rel)) {
    skipped.push(rel);
    continue;
  }
  checked++;
  const src = readFileSync(file, 'utf8');
  if (!MARKERS.some((m) => src.includes(m))) failures.push(file);
}

if (failures.length) {
  console.error('\n❌ Rotas em app/api/** sem auth-guard:\n');
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(
    '\nImporte um guard de auth:\n' +
      '  • `withAuth`/`requireInvestidor` de @/lib/wallet/auth-guard\n' +
      '  • `withPessoaAuth`/`requirePessoa` de @/lib/wallet/pessoa-auth\n' +
      '  • `isAdminAuthenticated`/`requireAdminCsrf` de @/lib/auth/admin(-csrf)\n' +
      'Se a rota for pública por design, adicione-a a PUBLIC_ROUTES com justificativa.\n',
  );
  process.exit(1);
}

console.log(
  `✓ ${ROOT}/**: ${checked} rota(s) verificada(s), todas usam auth-guard; ` +
    `${skipped.length} pública(s) na allowlist.`,
);
if (skipped.length) {
  skipped
    .sort()
    .forEach((r) => console.log(`  · ${r} — ${PUBLIC_ROUTES.get(r)}`));
}
