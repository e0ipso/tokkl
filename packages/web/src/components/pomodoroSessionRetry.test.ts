import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { ApiError } from '../api/client.ts';
import { hasSavedPomodoro, irrecoverablePomodoroError, pomodoroRetryDelay, watchPomodoroRetries } from './pomodoroSessionRetry.ts';
import type { UnsavedPomodoro } from './pomodoroSessionState.ts';

// The watcher listens on window for focus and reconnect; an EventTarget stands in for it.
const page = new EventTarget();
Object.assign(globalThis, { window: page });

const NOW = Date.parse('2026-10-21T10:30:00Z');
const realFetch = globalThis.fetch;
/** Lets the watcher's async run settle. setImmediate is not mocked, so it runs after pending promises. */
const settle = () => new Promise<void>((done) => setImmediate(done));
const unexpected = (error: unknown) => { throw error; };

function item(id: string, retryAt: number): UnsavedPomodoro {
  return {
    id, attempts: 1, retryAt,
    entry: {
      description: 'Write proposal', project_id: 3, task_id: 7, tags: ['draft'], billable: false,
      start: '2026-10-21T10:00:00.000Z', stop: '2026-10-21T10:30:00.000Z', duration: 1800,
    },
  };
}

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW }); });
afterEach(() => { mock.timers.reset(); globalThis.fetch = realFetch; });

test('the retry delay doubles from five seconds and stops growing at five minutes', () => {
  const delays = [1, 2, 3, 4, 5, 6, 7, 8, 50].map(pomodoroRetryDelay);
  assert.deepEqual(delays, [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  assert.equal(pomodoroRetryDelay(0), 5_000, 'a never-attempted save waits the first step');
});

test('client errors drop the pomodoro except authentication, timeout and rate limits', () => {
  for (const status of [400, 403, 404, 409, 422]) {
    assert.equal(irrecoverablePomodoroError(new ApiError(status, 'Rejected')), true, `${status}`);
  }
  for (const status of [401, 408, 429, 500, 502, 503]) {
    assert.equal(irrecoverablePomodoroError(new ApiError(status, 'Try later')), false, `${status}`);
  }
  assert.equal(irrecoverablePomodoroError(new TypeError('Failed to fetch')), false, 'a network failure is retried');
  assert.equal(irrecoverablePomodoroError(Object.assign(new Error('Bad'), { status: 400 })), false, 'only API answers count');
});

test('reconciliation asks for the exact span and matches only a stopped entry with the same instants', async () => {
  const urls: string[] = [];
  let answer: unknown[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  const pending = item('a', NOW).entry;
  const saved = (start: string, stop: string | null) => ({ id: 1, start, stop, duration: 1800 });

  assert.equal(await hasSavedPomodoro(pending), false);
  const query = new URL(urls[0]!, 'http://tokkl.test');
  assert.equal(query.pathname, '/api/v9/me/time_entries');
  assert.equal(query.searchParams.get('start_date'), pending.start);
  assert.equal(query.searchParams.get('end_date'), pending.stop);

  answer = [saved('2026-10-21T10:00:00+00:00', null), saved('2026-10-21T10:00:00+00:00', '2026-10-21T10:45:00+00:00')];
  assert.equal(await hasSavedPomodoro(pending), false, 'a running or longer entry is not this pomodoro');
  answer = [saved('2026-10-21T09:45:00+00:00', '2026-10-21T10:30:00+00:00')];
  assert.equal(await hasSavedPomodoro(pending), false, 'an entry with another start is not this pomodoro');
  answer = [saved('2026-10-21T12:00:00+02:00', '2026-10-21T10:30:00+00:00')];
  assert.equal(await hasSavedPomodoro(pending), true, 'instants match whatever offset the server writes');

  globalThis.fetch = async () => new Response('"Service unavailable"', { status: 503 });
  await assert.rejects(hasSavedPomodoro(pending), (error) => error instanceof ApiError && error.status === 503);
});

test('one wake-up waits for the earliest due pomodoro, but never less than five seconds', async () => {
  let queue = [item('late', NOW + 60_000), item('soon', NOW + 20_000)];
  const runs: boolean[] = [];
  const watcher = watchPomodoroRetries(() => queue, async (force) => { runs.push(force); queue = []; }, unexpected);
  mock.timers.tick(19_999);
  await settle();
  assert.deepEqual(runs, []);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(runs, [false]);
  mock.timers.tick(600_000);
  await settle();
  assert.deepEqual(runs, [false], 'an emptied queue schedules nothing');

  queue = [item('overdue', NOW - 60_000)];
  watcher.schedule();
  mock.timers.tick(4_999);
  await settle();
  assert.deepEqual(runs, [false]);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(runs, [false, false]);
  watcher.stop();
});

for (const event of ['focus', 'online']) {
  test(`${event === 'online' ? 'an' : 'a'} ${event} event retries at once, ignoring the backoff`, async () => {
    const queue = [item('a', NOW + 300_000)];
    const runs: boolean[] = [];
    const watcher = watchPomodoroRetries(() => queue, async (force) => { runs.push(force); }, unexpected);
    page.dispatchEvent(new Event(event));
    await settle();
    assert.deepEqual(runs, [true]);
    watcher.stop();
    page.dispatchEvent(new Event(event));
    mock.timers.tick(600_000);
    await settle();
    assert.deepEqual(runs, [true], 'a stopped watcher neither listens nor wakes');
  });
}

test('wake-ups during a retry coalesce into one forced follow-up', async () => {
  const queue = [item('a', NOW + 300_000)];
  const runs: boolean[] = [];
  let release!: () => void;
  const watcher = watchPomodoroRetries(() => queue, (force) => {
    runs.push(force);
    return runs.length === 1 ? new Promise<void>((done) => { release = done; }) : Promise.resolve();
  }, unexpected);
  page.dispatchEvent(new Event('focus'));
  await settle();
  page.dispatchEvent(new Event('online'));
  page.dispatchEvent(new Event('focus'));
  await settle();
  assert.deepEqual(runs, [true]);
  release();
  await settle();
  assert.deepEqual(runs, [true, true]);
  watcher.stop();
});

test('a failed retry is reported and the next wake-up is still scheduled', async () => {
  const queue = [item('a', NOW + 10_000)];
  const errors: unknown[] = [];
  let runs = 0;
  const watcher = watchPomodoroRetries(() => queue, async () => { runs++; throw new Error('offline'); }, (error) => errors.push(error));
  mock.timers.tick(10_000);
  await settle();
  assert.equal(runs, 1);
  assert.match(String(errors[0]), /offline/);
  mock.timers.tick(5_000);
  await settle();
  assert.equal(runs, 2);
  watcher.stop();
});
