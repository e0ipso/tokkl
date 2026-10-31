import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStorageConfig, safeDestination, StorageConfigurationError } from '../../src/storage/config.ts';

test('absent selector defaults to the data directory; explicit SQLite paths are decoded', () => {
  assert.deepEqual(parseStorageConfig({}, '/tmp/tokkl-data'), { backend: 'sqlite', filename: '/tmp/tokkl-data/tokkl.sqlite', busyTimeoutMs: 5000 });
  assert.equal(parseStorageConfig({ TOKKL_DATABASE_URL: 'sqlite::memory:' }, '/tmp').backend, 'sqlite');
  const config = parseStorageConfig({ TOKKL_DATABASE_URL: 'sqlite:///tmp/time%20data.sqlite' }, '/tmp');
  assert.equal(config.backend === 'sqlite' && config.filename, '/tmp/time data.sqlite');
});

for (const scheme of ['postgres', 'postgresql', 'mysql', 'mariadb']) {
  test(`${scheme} parses credentials once, bounds and verified TLS`, () => {
    const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${scheme}://test:p%40ss@localhost/tracker?pool_max=3&connect_timeout_ms=250&sslmode=verify-full` }, '/tmp');
    assert.notEqual(config.backend, 'sqlite');
    if (config.backend === 'sqlite') return;
    assert.equal(config.password, 'p@ss');
    assert.equal(config.poolMax, 3);
    assert.equal(config.connectTimeoutMs, 250);
    assert.deepEqual(config.tls, { mode: 'verify-full' });
    assert.equal(config.backend, scheme === 'postgresql' ? 'postgres' : scheme);
    assert.equal(safeDestination(config), `${config.backend}://localhost:${config.port}`);
    assert.doesNotMatch(safeDestination(config), /test|p@ss|tracker/);
  });
}

test('invalid explicit selectors reject without including any input or nested cause', () => {
  const invalid = ['', ' ', 'file:///tmp/a', 'sqlite://remote/tmp/a', 'sqlite:relative.sqlite', 'sqlite:///tmp/a?mode=rw',
    'sqlite:///tmp/%00a', 'sqlite:///tmp/../a', 'postgres://u:p@host/', 'mysql://host/db',
    'postgres://u:p@host/db?sslmode=require', 'mysql://u:p@host/db?sslmode=no-verify',
    'mysql://u:p@host/db?pool_max=0', 'mysql://u:p@host/db?pool_max=21',
    'mysql://u:p@host/db?connect_timeout_ms=0', 'mysql://u:p@host/db?connect_timeout_ms=60001',
    'mysql://u:p@host/db?pool_max=2&pool_max=3', 'mysql://u:p@host/db?unknown=secret',
    'mysql://u:p@host/db#secret', 'mysql://u:%zz@host/db', 'mysql://u:p@host/a/b'];
  for (const value of invalid) {
    assert.throws(() => parseStorageConfig({ TOKKL_DATABASE_URL: value }, '/tmp'), (error: unknown) => {
      assert.ok(error instanceof StorageConfigurationError);
      assert.equal(error.message, 'Invalid TOKKL_DATABASE_URL');
      assert.equal(error.cause, undefined);
      return true;
    }, value);
  }
});

test('plaintext is explicit, CA needs verified TLS, and IPv6 destinations are safe', () => {
  const config = parseStorageConfig({ TOKKL_DATABASE_URL: 'mariadb://u:p@[::1]:3307/db?sslmode=disable' }, '/tmp');
  assert.equal(config.backend !== 'sqlite' && config.tls.mode, 'disable');
  assert.equal(safeDestination(config), 'mariadb://[::1]:3307');
  assert.throws(() => parseStorageConfig({ TOKKL_DATABASE_URL: 'mysql://u:p@host/db?sslmode=disable&sslrootcert=/tmp/ca' }, '/tmp'));
});

test('URL normalization cannot silently change an explicit database path', () => {
  for (const path of ['/one/../two', '/one/%2e%2e/two', '/./two']) {
    assert.throws(() => parseStorageConfig({ TOKKL_DATABASE_URL: `postgres://u:p@host${path}` }, '/tmp'), StorageConfigurationError);
  }
});
