const MAX_AGE_MS = 26 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`NAV snapshot freshness: ${message}`);
  process.exitCode = 1;
}

function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

const baseUrl = process.env.OPS_BASE_URL?.trim();
const nowOverride = process.env.OPS_CHECK_NOW?.trim();
const now = nowOverride ? new Date(nowOverride) : new Date();

if (!baseUrl || Number.isNaN(now.getTime())) {
  fail('configuração inválida');
} else {
  try {
    const base = new URL(baseUrl);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const candidates = [utcDate(now), utcDate(yesterday)];
    let found = false;

    for (const date of candidates) {
      const url = new URL(`api/nav-snapshot/${date}`, base);
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 404) continue;
      if (!response.ok) {
        fail(`HTTP ${response.status}`);
        found = true;
        break;
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        fail('resposta JSON inválida');
        found = true;
        break;
      }

      const generatedAt = new Date(payload?.geradoEm);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || payload.data !== date || Number.isNaN(generatedAt.getTime())) {
        fail('snapshot fora do contrato');
        found = true;
        break;
      }

      const ageMs = now.getTime() - generatedAt.getTime();
      if (ageMs < -MAX_CLOCK_SKEW_MS) {
        fail('geradoEm está no futuro além da tolerância de relógio');
      } else if (ageMs >= MAX_AGE_MS) {
        fail('último snapshot tem 26 h ou mais');
      } else {
        console.log(`NAV snapshot freshness: ok (${date})`);
      }
      found = true;
      break;
    }

    if (!found) fail('nenhum snapshot das últimas 26 h');
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? 'timeout'
      : 'falha de transporte';
    fail(reason);
  }
}
