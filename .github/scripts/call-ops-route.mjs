const MIN_SECRET_LENGTH = 32;
const DEFAULT_TIMEOUT_MS = 70_000;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const label = process.env.OPS_ROUTE_LABEL?.trim() || 'ops route';
const baseUrl = process.env.OPS_BASE_URL?.trim();
const routePath = process.env.OPS_ROUTE_PATH?.trim();
const secret = process.env.OPS_CRON_SECRET?.trim();
const mode = process.env.OPS_ROUTE_MODE?.trim() || 'ops';

if (!baseUrl || !routePath || !routePath.startsWith('/')) {
  fail(`${label}: configuração de URL inválida`);
} else if (!secret || secret.length < MIN_SECRET_LENGTH) {
  fail(`${label}: OPS_CRON_SECRET ausente ou fraco`);
} else {
  try {
    const url = new URL(routePath, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || url.search || url.hash) {
      throw new Error('rota fora da origem configurada');
    }

    const response = await fetch(url, {
      method: mode === 'snapshot' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      fail(`${label}: HTTP ${response.status}`);
    } else {
      let payload;
      try {
        payload = await response.json();
      } catch {
        fail(`${label}: resposta JSON inválida`);
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        fail(`${label}: resposta fora do contrato`);
      } else if (payload?.alerta === true) {
        fail(`${label}: alerta operacional ativo`);
      } else if (mode === 'snapshot' && payload?.publicado !== true) {
        fail(`${label}: snapshot não publicado`);
      } else if (!process.exitCode) {
        console.log(`${label}: ok`);
      }
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? 'timeout'
      : 'falha de transporte';
    fail(`${label}: ${reason}`);
  }
}
