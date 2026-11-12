import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./call-ops-route.mjs', import.meta.url));
const secret = 'a'.repeat(32);
let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.statusCode = 404;
      res.end('{"private":"must-not-leak"}');
      return;
    }
    if (req.url === '/ok') res.end('{"alerta":false}');
    else if (req.url === '/alert') res.end('{"alerta":true,"private":"must-not-leak"}');
    else if (req.url === '/missing-alert') res.end('{"ok":true}');
    else if (req.url === '/string-alert') res.end('{"alerta":"true"}');
    else if (req.url === '/numeric-alert') res.end('{"alerta":1}');
    else if (req.url === '/null') res.end('null');
    else if (req.url === '/snapshot' && req.method === 'POST') res.end('{"publicado":true,"alerta":false}');
    else if (req.url === '/not-published') res.end('{"publicado":false,"alerta":false}');
    else {
      res.statusCode = 500;
      res.end('{"private":"must-not-leak"}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function run(path, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        OPS_BASE_URL: baseUrl,
        OPS_ROUTE_PATH: path,
        OPS_ROUTE_LABEL: 'test route',
        OPS_CRON_SECRET: secret,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('aceita resposta operacional sem alerta', async () => {
  const result = await run('/ok');
  assert.equal(result.code, 0);
  assert.match(result.output, /test route: ok/);
});

test('falha quando alerta está ativo sem vazar o corpo', async () => {
  const result = await run('/alert');
  assert.equal(result.code, 1);
  assert.match(result.output, /alerta operacional ativo/);
  assert.doesNotMatch(result.output, /must-not-leak/);
});

test('falha em HTTP não-2xx sem vazar o corpo', async () => {
  const result = await run('/error');
  assert.equal(result.code, 1);
  assert.match(result.output, /HTTP 500/);
  assert.doesNotMatch(result.output, /must-not-leak/);
});

test('recusa resposta que não seja objeto JSON', async () => {
  const result = await run('/null');
  assert.equal(result.code, 1);
  assert.match(result.output, /resposta fora do contrato/);
});

for (const path of ['/missing-alert', '/string-alert', '/numeric-alert']) {
  test(`recusa alerta ausente ou fora do tipo booleano: ${path}`, async () => {
    const result = await run(path);
    assert.equal(result.code, 1);
    assert.match(result.output, /resposta fora do contrato/);
  });
}

test('snapshot exige POST e publicado true', async () => {
  const ok = await run('/snapshot', { OPS_ROUTE_MODE: 'snapshot' });
  const blocked = await run('/not-published', { OPS_ROUTE_MODE: 'snapshot' });
  assert.equal(ok.code, 0);
  assert.equal(blocked.code, 1);
  assert.match(blocked.output, /snapshot não publicado/);
});

test('recusa segredo curto antes da chamada', async () => {
  const result = await run('/ok', { OPS_CRON_SECRET: 'curto' });
  assert.equal(result.code, 1);
  assert.match(result.output, /ausente ou fraco/);
});
