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

for (const relativePath of workflows) {
  test(`${relativePath} only calls ops routes that exist in the app`, async () => {
    const workflowPath = fileURLToPath(new URL(relativePath, import.meta.url));
    const contents = await readFile(workflowPath, 'utf8');
    const paths = [...contents.matchAll(/OPS_ROUTE_PATH:\s*(\S+)/g)].map((m) => m[1]);

    assert.ok(paths.length > 0, 'workflow calls at least one ops route');
    for (const routePath of paths) {
      assert.match(routePath, /^\/api\/ops\/[a-z0-9-]+$/);
      const routeFile = fileURLToPath(
        new URL(`../../app${routePath}/route.ts`, import.meta.url),
      );
      await assert.doesNotReject(readFile(routeFile, 'utf8'), `${routePath} has no route.ts`);
    }
  });

  test(`${relativePath} reports a disabled schedule instead of skipping silently`, async () => {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const contents = await readFile(path, 'utf8');

    assert.match(contents, /^  schedule-status:$/m);
    assert.match(contents, /::warning title=Ops alarms are OFF::/);
  });
}
