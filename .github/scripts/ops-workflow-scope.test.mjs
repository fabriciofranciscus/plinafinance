import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflows = [
  '../workflows/ops-emission-reconciliation.yml',
  '../workflows/ops-nav-snapshot.yml',
];

for (const relativePath of workflows) {
  test(`${relativePath} requires explicit repository opt-in`, async () => {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const contents = await readFile(path, 'utf8');

    assert.match(contents, /^\s+if: vars\.OPS_SCHEDULE_ENABLED == 'true'$/m);
  });
}
