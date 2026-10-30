import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserBackend, disposableDatabaseUrl } from './backend-options.ts';
import { parseStorageConfig } from '../packages/api/src/storage/config.ts';

test('browser backend selection refuses external database targets and unknown engines', () => {
  assert.equal(browserBackend({}), 'sqlite');
  for (const backend of ['postgres', 'mysql', 'mariadb'] as const) {
    assert.equal(browserBackend({ TOKKL_E2E_BACKEND: backend }), backend);
    assert.throws(() => browserBackend({ TOKKL_E2E_BACKEND: backend, TOKKL_DATABASE_URL: 'postgres://operator:secret@db/production' }), /operator database/);
  }
  assert.throws(() => browserBackend({ TOKKL_E2E_BACKEND: 'other' }), /Unsupported/);
});

test('the generated disposable URL preserves every validated connection setting', () => {
  for (const backend of ['postgres', 'mysql', 'mariadb'] as const) {
    const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${backend}://tokkl:generated%40password@127.0.0.1:35467/tokkl_test?sslmode=disable&pool_max=4&connect_timeout_ms=5000&query_timeout_ms=30000` }, '/tmp');
    assert.deepEqual(parseStorageConfig({ TOKKL_DATABASE_URL: disposableDatabaseUrl(config) }, '/tmp'), config);
  }
});
