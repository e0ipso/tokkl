import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_RELOAD_KEY, loadPageModule, nextPageLoadStep, type PageLoadEnvironment } from './pageLoad.ts';

test('a failed page load is retried once, then reloads the tab once, then fails', () => {
  assert.equal(nextPageLoadStep(1, false), 'retry');
  assert.equal(nextPageLoadStep(1, true), 'retry', 'the retry comes first even after a reload');
  assert.equal(nextPageLoadStep(2, false), 'reload');
  assert.equal(nextPageLoadStep(2, true), 'fail', 'a tab that already reloaded does not reload again');
  assert.equal(nextPageLoadStep(3, false), 'reload');
});

/** A session storage and a reload that only record what happens; `broken` storage throws on every call. */
function fakeBrowser({ flagged = false, broken = false } = {}) {
  const items = new Map<string, string>(flagged ? [[PAGE_RELOAD_KEY, '1']] : []);
  const seen = { reloads: 0 };
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  const env: PageLoadEnvironment = {
    storage: () => ({
      getItem: key => (broken ? fail() : (items.get(key) ?? null)),
      setItem: (key, value) => (broken ? fail() : void items.set(key, value)),
      removeItem: key => (broken ? fail() : void items.delete(key)),
    }),
    reload: () => {
      seen.reloads++;
    },
  };
  return { env, items, seen };
}

/** A loader that fails `failures` times, then gives `value`. */
function flaky(failures: number, value = 'page') {
  let calls = 0;
  const load = () =>
    ++calls <= failures ? Promise.reject(new TypeError('Failed to fetch module')) : Promise.resolve(value);
  return { load, calls: () => calls };
}

const settled = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise(resolve => setTimeout(() => resolve(false), 20)),
  ]);

test('a load that fails once is tried again and clears the reload flag when it works', async () => {
  const { env, items, seen } = fakeBrowser({ flagged: true });
  const { load, calls } = flaky(1);
  assert.equal(await loadPageModule(load, { env }), 'page');
  assert.equal(calls(), 2);
  assert.equal(seen.reloads, 0);
  assert.equal(items.has(PAGE_RELOAD_KEY), false);
});

test('a load that fails twice sets the flag and reloads, and never settles', async () => {
  const { env, items, seen } = fakeBrowser();
  const pending = loadPageModule(flaky(2).load, { env });
  assert.equal(await settled(pending), false);
  assert.equal(seen.reloads, 1);
  assert.equal(items.get(PAGE_RELOAD_KEY), '1');
});

test('after a reload a load that still fails twice fails instead of reloading again', async () => {
  const { env, seen } = fakeBrowser({ flagged: true });
  const { load, calls } = flaky(2);
  await assert.rejects(loadPageModule(load, { env }), /Failed to fetch module/);
  assert.equal(calls(), 2);
  assert.equal(seen.reloads, 0);
});

test('without usable session storage the load fails rather than risk a reload loop', async () => {
  const { env, seen } = fakeBrowser({ broken: true });
  await assert.rejects(loadPageModule(flaky(2).load, { env }), /Failed to fetch module/);
  assert.equal(seen.reloads, 0);
  assert.equal(await loadPageModule(flaky(0).load, { env }), 'page', 'a load that works ignores the storage error');
});

test('a prefetch that would reload fails instead and leaves the flag unset', async () => {
  const { env, items, seen } = fakeBrowser();
  await assert.rejects(loadPageModule(flaky(2).load, { env, mayReload: false }), /Failed to fetch module/);
  assert.equal(seen.reloads, 0);
  assert.equal(items.has(PAGE_RELOAD_KEY), false, 'the visit that follows may still reload');
});
