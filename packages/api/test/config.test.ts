import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-config-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('TOKKL_* variables configure the server without notices', () => {
  const dir = tempDir();
  const { config, notices } = loadConfig({
    TOKKL_DATA_DIR: dir, TOKKL_WEB_ROOT: join(dir, 'web'), TOKKL_TRUST_PROXY: 'true',
    TOKKL_SESSION_DAYS: '7', TOKKL_SETUP_CODE: 'ABCD-EFGH-JKLM',
  });
  assert.equal(config.dataDir, dir);
  assert.equal(config.databasePath, join(dir, 'tokkl.sqlite'));
  assert.equal(config.webRoot, join(dir, 'web'));
  assert.equal(config.trustProxy, true);
  assert.equal(config.sessionDays, 7);
  assert.equal(config.setupCode, 'ABCD-EFGH-JKLM');
  assert.deepEqual(notices, []);
  assert.equal(loadConfig({ TOKKL_DATABASE: join(dir, 'other.sqlite') }).config.databasePath, join(dir, 'other.sqlite'));
});

test('TIMETRACK_* variables still work and log one deprecation line', () => {
  const dir = tempDir();
  const { config, notices } = loadConfig({
    TIMETRACK_DATA_DIR: dir, TIMETRACK_DATABASE: join(dir, 'db.sqlite'), TIMETRACK_WEB_ROOT: join(dir, 'web'),
    TIMETRACK_TRUST_PROXY: 'yes', TIMETRACK_SESSION_DAYS: '3', TIMETRACK_SETUP_CODE: 'OLD-CODE',
  });
  assert.equal(config.dataDir, dir);
  assert.equal(config.databasePath, join(dir, 'db.sqlite'));
  assert.equal(config.webRoot, join(dir, 'web'));
  assert.equal(config.trustProxy, true);
  assert.equal(config.sessionDays, 3);
  assert.equal(config.setupCode, 'OLD-CODE');
  assert.equal(notices.length, 1);
  for (const name of ['DATA_DIR', 'DATABASE', 'WEB_ROOT', 'TRUST_PROXY', 'SESSION_DAYS', 'SETUP_CODE']) {
    assert.ok(notices[0]!.includes(`TIMETRACK_${name}`), `names TIMETRACK_${name}`);
    assert.ok(notices[0]!.includes(`TOKKL_${name}`), `suggests TOKKL_${name}`);
  }
});

test('a TOKKL_* variable wins over its TIMETRACK_* name, which then logs nothing', () => {
  const { config, notices } = loadConfig({ TOKKL_SESSION_DAYS: '5', TIMETRACK_SESSION_DAYS: '9' });
  assert.equal(config.sessionDays, 5);
  assert.deepEqual(notices, []);
});

test('an install with only timetrack.sqlite keeps using it and never moves it', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'timetrack.sqlite'), '');
  const { config, notices } = loadConfig({ TOKKL_DATA_DIR: dir });
  assert.equal(config.databasePath, join(dir, 'timetrack.sqlite'));
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /timetrack\.sqlite/);
  assert.deepEqual(readdirSync(dir), ['timetrack.sqlite']);
});

test('a fresh install uses tokkl.sqlite, and tokkl.sqlite wins when both files exist', () => {
  const fresh = tempDir();
  const loaded = loadConfig({ TOKKL_DATA_DIR: fresh });
  assert.equal(loaded.config.databasePath, join(fresh, 'tokkl.sqlite'));
  assert.deepEqual(loaded.notices, []);
  assert.equal(existsSync(loaded.config.databasePath), false, 'loading the config creates nothing');

  const both = tempDir();
  writeFileSync(join(both, 'timetrack.sqlite'), '');
  writeFileSync(join(both, 'tokkl.sqlite'), '');
  const upgraded = loadConfig({ TOKKL_DATA_DIR: both });
  assert.equal(upgraded.config.databasePath, join(both, 'tokkl.sqlite'));
  assert.deepEqual(upgraded.notices, []);
});

test('an explicit database path is used as given even when timetrack.sqlite exists', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'timetrack.sqlite'), '');
  const { config, notices } = loadConfig({ TOKKL_DATA_DIR: dir, TOKKL_DATABASE: join(dir, 'tokkl.sqlite') });
  assert.equal(config.databasePath, join(dir, 'tokkl.sqlite'));
  assert.deepEqual(notices, []);
});
