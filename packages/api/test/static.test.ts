import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db/index.ts';
import { testConfig, testServer } from './helpers.ts';

const webRoots: string[] = [];

after(() => {
  for (const webRoot of webRoots) rmSync(webRoot, { recursive: true, force: true });
});

function makeWebRoot(): string {
  const webRoot = mkdtempSync(join(tmpdir(), 'tokkl-web-'));
  webRoots.push(webRoot);
  return webRoot;
}

test('page routes serve the app shell while API paths keep JSON 404s', async () => {
  const webRoot = makeWebRoot();
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  const app = testServer(createApp({ db: openDatabase(':memory:'), config: { ...testConfig(), webRoot }, setup: { code: null } }));

  for (const path of ['/', '/reports', '/reports?range=last_week', '/projects', '/settings']) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
  }
  const api = await app.request('/api/v9/nope');
  assert.equal(api.status, 403);
  const unknown = await app.request('/reports/api/v9/whatever', { method: 'POST' });
  assert.equal(unknown.status, 404);
  const csp = (await app.request('/')).headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
});

test('assets are cached immutably, and a missing asset is a 404', async () => {
  const webRoot = makeWebRoot();
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html>');
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'assets', 'app-abc.js'), 'console.log(1)');
  const config = { ...testConfig(), webRoot };
  const previous = process.cwd();
  process.chdir(webRoot);
  try {
    const app = testServer(createApp({ db: openDatabase(':memory:'), config, setup: { code: null } }));
    const hit = await app.request('/assets/app-abc.js');
    assert.equal(hit.status, 200);
    assert.match(hit.headers.get('cache-control') ?? '', /immutable/);
    const miss = await app.request('/assets/gone-123.js');
    assert.equal(miss.status, 404);
    assert.doesNotMatch(miss.headers.get('cache-control') ?? '', /immutable/);
  } finally {
    process.chdir(previous);
  }
});
