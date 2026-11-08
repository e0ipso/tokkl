import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from './types.ts';
import { connectTimerStream, type TimerEventSource } from './timerStream.ts';

class FakeSource implements TimerEventSource {
  readyState = 0;
  closed = false;
  readonly #listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: unknown): void {
    if (this.closed) return;
    for (const listener of this.#listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }
  open(): void {
    this.readyState = 1;
    this.emit('open');
  }
  /** Opens the source and sends the state the server sends first. */
  start(revision: number): void {
    this.open();
    this.emit('timer', JSON.stringify(state(revision)));
  }
}

const state = (revision: number): TimerState => ({
  revision,
  server_time: '2026-10-27T10:00:00.000Z',
  running_entry: null,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});

function setup() {
  const sources: FakeSource[] = [];
  const states: TimerState[] = [];
  const statuses: boolean[] = [];
  const stop = connectTimerStream(
    () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    { onState: s => states.push(s), onStatus: up => statuses.push(up) },
    5000,
  );
  const at = (index: number): FakeSource => {
    const source = sources[index];
    if (!source) throw new Error(`No source ${index} was opened`);
    return source;
  };
  return { sources, at, states, statuses, stop };
}

test('the stream counts as up from its first state, not from opening, and status reports only changes', () => {
  const { at, states, statuses, stop } = setup();
  const source = at(0);
  source.open();
  assert.deepEqual(statuses, [], 'an open connection that sent no state yet leaves polling on');
  source.emit('timer', JSON.stringify(state(1)));
  source.emit('timer', JSON.stringify(state(2)));
  assert.deepEqual(
    states.map(s => s.revision),
    [1, 2],
  );
  assert.deepEqual(statuses, [true]);
  // The browser reconnects by itself while the source is connecting; each error is a change only once,
  // and the reconnected source is up again with its first state.
  source.readyState = 0;
  source.emit('error');
  source.emit('error');
  source.open();
  assert.deepEqual(statuses, [true, false]);
  source.emit('timer', JSON.stringify(state(3)));
  assert.deepEqual(statuses, [true, false, true]);
  stop();
});

const malformed: Array<[string, string]> = [
  ['not JSON', '{not json'],
  ['a wrong revision', JSON.stringify({ revision: 'x' })],
  // A revision and a server time are not enough: the nested parts are checked too.
  ['a state without its parts', JSON.stringify({ revision: 3, server_time: '2026-10-27T10:00:00.000Z' })],
  ['a malformed pause', JSON.stringify({ ...state(4), pause: { paused: true } })],
];

for (const [name, data] of malformed) {
  test(`an event with ${name} counts as down and reopens the stream after the delay`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { sources, at, states, statuses, stop } = setup();
    at(0).start(1);
    at(0).emit('timer', data);
    assert.deepEqual(statuses, [true, false], 'polling takes over at once');
    assert.equal(at(0).closed, true);
    assert.deepEqual(
      states.map(s => s.revision),
      [1],
      'nothing reaches the handler',
    );
    t.mock.timers.tick(4999);
    assert.equal(sources.length, 1);
    t.mock.timers.tick(1);
    assert.equal(sources.length, 2);
    at(1).start(2);
    assert.deepEqual(statuses, [true, false, true]);
    stop();
  });
}

test('a first event that does not decode never brings the stream up', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sources, at, statuses, stop } = setup();
  at(0).open();
  at(0).emit('timer', '{not json');
  assert.deepEqual(statuses, []);
  assert.equal(at(0).closed, true);
  t.mock.timers.tick(5000);
  assert.equal(sources.length, 2);
  stop();
});

test('a source the browser gave up on is closed and reopened after the delay, until stopped', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sources, at, statuses, stop } = setup();
  at(0).start(1);
  at(0).readyState = 2;
  at(0).emit('error');
  assert.equal(at(0).closed, true);
  assert.deepEqual(statuses, [true, false]);
  t.mock.timers.tick(4999);
  assert.equal(sources.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sources.length, 2);
  at(1).readyState = 2;
  at(1).emit('error');
  stop();
  t.mock.timers.tick(10_000);
  assert.equal(sources.length, 2, 'stopping cancels the pending reopen');
  at(1).start(2);
  assert.deepEqual(statuses, [true, false], 'a stopped stream reports nothing more');
});

test('a stream that stays silent past the timeout counts as down and opens again', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sources, at, states, statuses, stop } = setup();
  at(0).start(1);
  // Each keep-alive or state restarts the wait.
  t.mock.timers.tick(59_999);
  at(0).emit('keep-alive', '');
  t.mock.timers.tick(59_999);
  at(0).emit('timer', JSON.stringify(state(2)));
  t.mock.timers.tick(59_999);
  assert.deepEqual(statuses, [true]);
  assert.equal(sources.length, 1);

  // A proxy that holds the body back: nothing arrives, so polling takes over and a new source opens.
  t.mock.timers.tick(1);
  assert.deepEqual(statuses, [true, false]);
  assert.equal(at(0).closed, true);
  assert.equal(sources.length, 2);
  at(1).start(3);
  assert.deepEqual(
    states.map(s => s.revision),
    [1, 2, 3],
  );
  assert.deepEqual(statuses, [true, false, true]);

  // While the browser reconnects by itself there is nothing to time out, and a stopped stream waits for nothing.
  at(1).readyState = 0;
  at(1).emit('error');
  t.mock.timers.tick(120_000);
  assert.equal(sources.length, 2);
  at(1).start(4);
  stop();
  t.mock.timers.tick(120_000);
  assert.equal(sources.length, 2);
  assert.deepEqual(statuses, [true, false, true, false, true]);
});

test('keep-alives do not keep a connection that never sent a state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sources, at, statuses, stop } = setup();
  at(0).open();
  t.mock.timers.tick(30_000);
  at(0).emit('keep-alive', '');
  t.mock.timers.tick(29_999);
  assert.equal(sources.length, 1);
  t.mock.timers.tick(1);
  assert.equal(at(0).closed, true, 'the wait runs from the open, whatever keep-alives arrive');
  assert.equal(sources.length, 2);
  assert.deepEqual(statuses, [], 'it never counted as up');

  // After a browser reconnect, keep-alives count only once the new connection sent its state.
  at(1).start(1);
  at(1).readyState = 0;
  at(1).emit('error');
  at(1).open();
  t.mock.timers.tick(59_999);
  at(1).emit('keep-alive', '');
  t.mock.timers.tick(1);
  assert.equal(sources.length, 3);
  assert.deepEqual(statuses, [true, false]);
  stop();
});

test('stopping closes the open source', () => {
  const { at, stop } = setup();
  at(0).open();
  stop();
  assert.equal(at(0).closed, true);
  mock.reset();
});
