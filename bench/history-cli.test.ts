import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// These commands must reject input before provisioning or opening any storage.
test('history CLI refuses operator targets and unknown engines without echoing private settings', () => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE_URL$/.test(key)));
  for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb']) {
    const child = spawnSync(process.execPath, ['bench/history.ts', '--backend', backend], {
      env: { ...clean, TOKKL_DATABASE_URL: 'private-operator-target' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /refuse operator database targets/);
    assert.doesNotMatch(child.stderr + child.stdout, /private-operator-target|Disposable .* created/);
  }
  const child = spawnSync(process.execPath, ['bench/history.ts', '--backend', 'unsupported'], { env: clean, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /--backend must be sqlite, postgres, mysql or mariadb/);
  assert.doesNotMatch(child.stderr + child.stdout, /Disposable .* created/);
});
