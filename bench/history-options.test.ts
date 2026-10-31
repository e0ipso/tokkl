import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyBackend, historyEnvironment, databaseUrl } from './history-options.ts';
import { parseStorageConfig } from '../packages/api/src/storage/config.ts';

test('history selection refuses external targets and accepts only the disposable engine enum', () => {
  assert.equal(historyBackend(undefined, {}), 'sqlite');
  for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) assert.equal(historyBackend(backend, {}), backend);
  for (const input of ['', 'postgresql', 'sqlite:/tmp/operator', 'mysql://operator', 'unknown']) {
    assert.throws(() => historyBackend(input, {}), /^Error: --backend must be sqlite, postgres, mysql or mariadb$/);
  }
  for (const key of ['TOKKL_DATABASE_URL', 'TIMETRACK_DATABASE_URL', 'DATABASE_URL']) {
    assert.throws(() => historyBackend('sqlite', { [key]: 'private-operator-target' }), error => error instanceof Error && !error.message.includes('private-operator-target'));
  }
});

test('child settings come only from a fresh disposable configuration and round trip exactly', () => {
  const directory = '/tmp/owned-history-test';
  for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
    const config = parseStorageConfig(backend === 'sqlite' ? {} : { TOKKL_DATABASE_URL: `${backend}://tokkl:test-only@127.0.0.1:12345/owned?sslmode=disable` }, directory);
    assert.deepEqual(parseStorageConfig({ TOKKL_DATABASE_URL: databaseUrl(config) }, directory), config);
    const env = historyEnvironment({ TOKKL_DATA_DIR: '/operator', TIMETRACK_SETUP_CODE: 'operator', PORT: '1', HOST: 'operator', PATH: '/bin' }, config, directory, 8290, 'test-setup');
    assert.equal(env.TOKKL_DATA_DIR, directory);
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, '8290');
    assert.equal(env.TIMETRACK_SETUP_CODE, undefined);
    assert.equal(env.PATH, '/bin');
    assert.deepEqual(parseStorageConfig(env, directory), config);
  }
});
