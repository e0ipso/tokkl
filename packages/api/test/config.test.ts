import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigurationError, loadConfig } from '../src/config.ts';
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-config-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('URL selects storage while unrelated current and legacy settings retain their behavior', () => {
  const dir = tempDir();
  const { config, notices } = loadConfig({
    TOKKL_DATA_DIR: dir,
    TOKKL_DATABASE_URL: 'sqlite::memory:',
    TIMETRACK_WEB_ROOT: join(dir, 'web'),
    TIMETRACK_TRUST_PROXY: '2',
    TOKKL_SESSION_DAYS: '7',
    TOKKL_SETUP_CODE: 'CODE',
  });
  assert.equal(config.storage.backend, 'sqlite');
  assert.equal(config.webRoot, join(dir, 'web'));
  assert.equal(config.trustProxy, 2);
  assert.equal(config.sessionDays, 7);
  assert.equal(config.setupCode, 'CODE');
  assert.equal(notices.length, 1);
  assert.equal(
    loadConfig({ TOKKL_DATA_DIR: dir, TOKKL_SESSION_DAYS: '5', TIMETRACK_SESSION_DAYS: '9' }).config.sessionDays,
    5,
  );
});
test('absent selector defaults without creating files', () => {
  const dir = tempDir();
  assert.deepEqual(loadConfig({ TOKKL_DATA_DIR: dir }).config.storage, {
    backend: 'sqlite',
    filename: join(dir, 'tokkl.sqlite'),
    busyTimeoutMs: 5000,
  });
  assert.deepEqual(readdirSync(dir), []);
});
test('old settings or default filename require explicit selection and leave data untouched', () => {
  for (const name of ['TOKKL_DATABASE', 'TIMETRACK_DATABASE', 'file']) {
    const dir = tempDir();
    writeFileSync(join(dir, 'timetrack.sqlite'), 'keep');
    const env = { TOKKL_DATA_DIR: dir, ...(name === 'file' ? {} : { [name]: join(dir, 'old.sqlite') }) };
    assert.throws(() => loadConfig(env), /explicit TOKKL_DATABASE_URL/);
    assert.deepEqual(readdirSync(dir), ['timetrack.sqlite']);
  }
  const dir = tempDir();
  writeFileSync(join(dir, 'timetrack.sqlite'), 'keep');
  assert.equal(
    loadConfig({ TOKKL_DATA_DIR: dir, TOKKL_DATABASE_URL: 'sqlite::memory:' }).config.storage.backend,
    'sqlite',
  );
});
test('invalid explicit selector refuses without exposing credentials or creating a fallback', () => {
  const dir = tempDir();
  assert.throws(() => loadConfig({ TOKKL_DATA_DIR: dir, TOKKL_DATABASE_URL: 'bad://secret:credential@host/data' }), {
    message: 'Invalid TOKKL_DATABASE_URL',
  });
  assert.deepEqual(readdirSync(dir), []);
});
test('TOKKL_TRUST_PROXY accepts off, a hop count or proxy addresses and ranges, and rejects anything else', () => {
  const dir = tempDir();
  const trust = (value: string | undefined) =>
    loadConfig({ TOKKL_DATA_DIR: dir, TOKKL_TRUST_PROXY: value }).config.trustProxy;
  assert.equal(trust(undefined), false);
  assert.equal(trust(''), false);
  assert.equal(trust('0'), false);
  assert.equal(trust('1'), 1);
  assert.equal(trust('3'), 3);
  assert.deepEqual(trust('10.0.0.1, 192.168.0.0/16,::1 , fd00::/8,0.0.0.0/0'), [
    '10.0.0.1',
    '192.168.0.0/16',
    '::1',
    'fd00::/8',
    '0.0.0.0/0',
  ]);
  for (const value of [
    'true',
    'yes',
    'on',
    'false',
    'no',
    'off',
    '-1',
    '1.5',
    '10.0.0.0/33',
    '::/129',
    '10.0.0.0/',
    '10.0.0.0/8/1',
    '10.0.0.1,,10.0.0.2',
    'proxy.example.com',
    'loopback',
    '9'.repeat(309),
    '9007199254740993',
  ]) {
    assert.throws(
      () => trust(value),
      (error: Error) =>
        /TOKKL_TRUST_PROXY/.test(error.message) && /hop/.test(error.message) && /CIDR/.test(error.message),
      value,
    );
  }
});
test('startup names TOKKL_TRUST_PROXY when its value is invalid', async () => {
  const dir = tempDir();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
    env: {
      ...process.env,
      TOKKL_DATA_DIR: dir,
      TOKKL_DATABASE_URL: 'sqlite::memory:',
      TOKKL_TRUST_PROXY: 'true',
      HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', b => {
    logs += String(b);
  });
  child.stderr.on('data', b => {
    logs += String(b);
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    assert.equal(await new Promise<number | null>(r => child.once('exit', r)), 1);
  } finally {
    clearTimeout(deadline);
  }
  assert.match(logs, /Startup failed\. Invalid TOKKL_TRUST_PROXY/);
  assert.doesNotMatch(logs, /tokkl listening/);
});
test('PORT, HOST, TOKKL_SESSION_DAYS and TOKKL_LOG_LEVEL accept their ranges and name the setting otherwise', () => {
  const dir = tempDir();
  const load = (env: NodeJS.ProcessEnv) => loadConfig({ TOKKL_DATA_DIR: dir, ...env }).config;
  const defaults = load({});
  assert.deepEqual(
    [defaults.port, defaults.host, defaults.sessionDays, defaults.logLevel],
    [8080, '0.0.0.0', 30, 'info'],
  );
  assert.equal(load({ PORT: '0' }).port, 0);
  assert.equal(load({ PORT: ' 65535 ' }).port, 65535);
  assert.equal(load({ HOST: '::1' }).host, '::1');
  assert.equal(load({ TOKKL_SESSION_DAYS: '365' }).sessionDays, 365);
  assert.equal(load({ TOKKL_LOG_LEVEL: 'WARN' }).logLevel, 'warn');
  const refused: Array<[NodeJS.ProcessEnv, string]> = [
    [{ PORT: '65536' }, 'PORT'],
    [{ PORT: 'http' }, 'PORT'],
    [{ PORT: '80.5' }, 'PORT'],
    [{ HOST: 'two words' }, 'HOST'],
    [{ TOKKL_SESSION_DAYS: '0' }, 'TOKKL_SESSION_DAYS'],
    [{ TIMETRACK_SESSION_DAYS: '366' }, 'TOKKL_SESSION_DAYS'],
    [{ TOKKL_LOG_LEVEL: 'verbose' }, 'TOKKL_LOG_LEVEL'],
  ];
  for (const [env, name] of refused)
    assert.throws(
      () => load(env),
      (error: Error) => error instanceof ConfigurationError && error.message.startsWith(`Invalid ${name}`),
      JSON.stringify(env),
    );
});
test('database selection errors are configuration errors, so startup prints them', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'timetrack.sqlite'), 'keep');
  assert.throws(() => loadConfig({ TOKKL_DATA_DIR: dir }), ConfigurationError);
  assert.throws(() => loadConfig({ TOKKL_DATA_DIR: tempDir(), TOKKL_DATABASE_URL: 'bad://x' }), ConfigurationError);
});
