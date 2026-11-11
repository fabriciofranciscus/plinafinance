import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-nav-snapshot-freshness.mjs', import.meta.url));
const now = '2026-11-12T10:00:00.000Z';
let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/fresh/api/nav-snapshot/2026-11-12') {
      res.statusCode = 404;
      res.end('{"private":"must-not-leak"}');
    } else if (req.url === '/fresh/api/nav-snapshot/2026-11-11') {
      res.end('{"data":"2026-11-11","geradoEm":"2026-11-11T09:17:00.000Z"}');
    } else if (req.url === '/stale/api/nav-snapshot/2026-11-12') {
      res.statusCode = 404;
      res.end('{}');
    } else if (req.url === '/stale/api/nav-snapshot/2026-11-11') {
      res.end('{"data":"2026-11-11","geradoEm":"2026-11-11T08:00:00.000Z"}');
    } else if (req.url === '/missing/api/nav-snapshot/2026-11-12'
        || req.url === '/missing/api/nav-snapshot/2026-11-11') {
      res.statusCode = 404;
      res.end('{}');
    } else if (req.url === '/error/api/nav-snapshot/2026-11-12') {
      res.statusCode = 503;
      res.end('{"private":"must-not-leak"}');
    } else if (req.url === '/invalid/api/nav-snapshot/2026-11-12') {
      res.end('{"data":"2026-11-12","geradoEm":"not-a-date","private":"must-not-leak"}');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function run(prefix) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        OPS_BASE_URL: `${baseUrl}/${prefix}/`,
        OPS_CHECK_NOW: now,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('aceita o snapshot de ontem com menos de 26 horas', async () => {
  const result = await run('fresh');
  assert.equal(result.code, 0);
  assert.match(result.output, /freshness: ok \(2026-11-11\)/);
});

test('falha quando o último snapshot tem 26 horas ou mais', async () => {
  const result = await run('stale');
  assert.equal(result.code, 1);
  assert.match(result.output, /26 h ou mais/);
});

test('falha quando não existe snapshot recente', async () => {
  const result = await run('missing');
  assert.equal(result.code, 1);
  assert.match(result.output, /nenhum snapshot/);
});

test('falha em HTTP não-2xx sem vazar o corpo', async () => {
  const result = await run('error');
  assert.equal(result.code, 1);
  assert.match(result.output, /HTTP 503/);
  assert.doesNotMatch(result.output, /must-not-leak/);
});

test('recusa snapshot fora do contrato sem vazar o corpo', async () => {
  const result = await run('invalid');
  assert.equal(result.code, 1);
  assert.match(result.output, /fora do contrato/);
  assert.doesNotMatch(result.output, /must-not-leak/);
});
