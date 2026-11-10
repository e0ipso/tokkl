import type { TimerState } from '@tokkl/types';
import { forbidden, unavailable } from '../lib/errors.ts';

/** Read by the same statement as the user. */
export type StreamCredentialResult = { valid: false } | { valid: true; revision: number };

/** Node's ServerResponse has them all. */
export interface EventStreamResponse {
  readonly destroyed: boolean;
  readonly headersSent: boolean;
  readonly socket: { readonly destroyed: boolean } | null;
  readonly writableLength: number;
  on(event: 'close', listener: () => void): unknown;
  once(event: 'drain', listener: () => void): unknown;
  off(event: 'drain', listener: () => void): unknown;
  writeHead(status: number, headers: Record<string, string>): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): unknown;
}

const EVENT_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
  Connection: 'close',
};
const refused = () => forbidden('Incorrect username and/or password');
/** A full process sheds the stream; the client polls meanwhile and tries again. */
const STREAMS_FULL_RETRY_SECONDS = 5;
const KEEP_ALIVE_EVENT = 'event: keep-alive\ndata:\n\n';
/** A random reconnect wait per stream, so clients that lost their streams together do not reconnect at once. */
const RECONNECT_DELAY_MS = Object.freeze({ min: 5000, max: 15000 });
const reconnectDelay = () =>
  RECONNECT_DELAY_MS.min + Math.floor(Math.random() * (RECONNECT_DELAY_MS.max - RECONNECT_DELAY_MS.min + 1));
export interface TimerStreamLimits {
  /** Also runs the credential check. */
  keepAliveMs: number;
  /** How long a full socket may take to drain before the stream ends. */
  drainTimeoutMs: number;
  /** A write past it ends the stream. */
  maxBufferedBytes: number;
  /** Counts opening streams; a new one past it ends the user's oldest. */
  maxPerUser: number;
  /** Counts opening streams; a new one past it gets a 503. */
  maxStreams: number;
}

export const DEFAULT_TIMER_STREAM_LIMITS: Readonly<TimerStreamLimits> = Object.freeze({
  keepAliveMs: 25000,
  drainTimeoutMs: 30000,
  maxBufferedBytes: 64 * 1024,
  maxPerUser: 10,
  maxStreams: 1000,
});

interface TimerStreamOptions extends TimerStreamLimits {
  /** Called, never awaited, when a check reads a revision newer than this process delivered. */
  onBehind?: (id: number, revision: number) => void;
}
type PassingCheck = Extract<StreamCredentialResult, { valid: true }>;
interface Stream {
  res: EventStreamResponse;
  check: () => Promise<StreamCredentialResult>;
  /** Streams with the same key share one check. */
  credential: string | symbol;
  ready: boolean;
  revision: number;
  draining?: { listener: () => void; timeout: NodeJS.Timeout };
}
interface Group {
  streams: Set<Stream>;
  queue: Promise<void>;
  latest?: TimerState;
  retired?: boolean;
  timer?: NodeJS.Timeout;
  ticking: boolean;
}
/** Process-local. Credential checks serialize per user, and streams of one credential share each result. */
export class TimerStreams {
  readonly #state: (id: number) => Promise<TimerState>;
  readonly #users = new Map<number, Group>();
  readonly #builds = new Map<number, Promise<TimerState | undefined>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #options: TimerStreamLimits;
  readonly #onBehind: (id: number, revision: number) => void;
  #closed = false;
  constructor(state: (id: number) => Promise<TimerState>, options: TimerStreamOptions) {
    this.#state = state;
    this.#options = { ...options };
    this.#onBehind = options.onBehind ?? (() => {});
  }
  #group(id: number): Group {
    let group = this.#users.get(id);
    if (!group) {
      group = { streams: new Set(), queue: Promise.resolve(), ticking: false };
      this.#users.set(id, group);
    }
    return group;
  }
  #track<T>(work: Promise<T>): Promise<T> {
    this.#pending.add(work);
    void work.then(
      () => this.#pending.delete(work),
      () => this.#pending.delete(work),
    );
    return work;
  }
  #enqueue(group: Group, work: () => Promise<void>): Promise<void> {
    const next = group.queue.then(work);
    group.queue = next.catch(() => {});
    return this.#track(next);
  }
  #count(): number {
    let count = 0;
    for (const group of this.#users.values()) count += group.streams.size;
    return count;
  }
  /** Past the per-user cap the oldest streams end; past the process cap the new stream is refused. */
  #join(id: number, stream: Stream): Group {
    const held = this.#users.get(id)?.streams.size ?? 0;
    const ending = Math.max(0, held + 1 - this.#options.maxPerUser);
    if (this.#count() - ending >= this.#options.maxStreams)
      throw unavailable('Too many timer streams, try again later', STREAMS_FULL_RETRY_SECONDS);
    const group = this.#group(id);
    group.streams.add(stream);
    for (const oldest of group.streams) {
      if (group.streams.size <= this.#options.maxPerUser) break;
      this.#end(id, group, oldest);
    }
    return group;
  }
  #live(group: Group, stream: Stream): boolean {
    return !this.#closed && !group.retired && group.streams.has(stream) && !stream.res.destroyed;
  }
  /** Each credential is checked once, in order; a check that throws fails every stream holding it. */
  async #passing(group: Group, streams: Stream[]): Promise<Map<Stream, PassingCheck>> {
    const results = new Map<string | symbol, StreamCredentialResult>();
    const passing = new Map<Stream, PassingCheck>();
    for (const stream of streams) {
      if (!this.#live(group, stream)) continue;
      let result = results.get(stream.credential);
      if (!result) {
        result = await stream.check().catch((): StreamCredentialResult => ({ valid: false }));
        results.set(stream.credential, result);
      }
      if (result.valid && this.#live(group, stream)) passing.set(stream, result);
    }
    return passing;
  }
  /** Undefined when the stream must not receive anything. */
  async #valid(group: Group, stream: Stream): Promise<PassingCheck | undefined> {
    return (await this.#passing(group, [stream])).get(stream);
  }
  #end(id: number, group: Group, stream: Stream): void {
    this.#forget(id, group, stream);
    try {
      stream.res.end();
    } catch {
      /* A broken subscriber cannot suppress another. */
    }
  }
  #forget(id: number, group: Group, stream: Stream): void {
    if (stream.draining) {
      clearTimeout(stream.draining.timeout);
      stream.res.off('drain', stream.draining.listener);
      stream.draining = undefined;
    }
    group.streams.delete(stream);
    if (group.streams.size) return;
    clearInterval(group.timer);
    group.timer = undefined;
    if (this.#users.get(id) === group) this.#users.delete(id);
  }
  /** A full socket gets `drainTimeoutMs` to drain; only a stream still full after that ends. */
  #write(id: number, group: Group, stream: Stream, message: string): void {
    if (group.retired || !group.streams.has(stream)) return;
    try {
      const buffered = stream.res.writableLength;
      if (buffered > 0 && buffered + Buffer.byteLength(message) > this.#options.maxBufferedBytes) {
        this.#end(id, group, stream);
        return;
      }
      if (!stream.res.write(message)) this.#awaitDrain(id, group, stream);
    } catch {
      this.#end(id, group, stream);
    }
  }
  #awaitDrain(id: number, group: Group, stream: Stream): void {
    if (stream.draining || !group.streams.has(stream)) return;
    const listener = () => {
      if (stream.draining?.listener !== listener) return;
      clearTimeout(stream.draining.timeout);
      stream.draining = undefined;
    };
    const timeout = setTimeout(() => this.#end(id, group, stream), this.#options.drainTimeoutMs);
    stream.draining = { listener, timeout };
    stream.res.once('drain', listener);
  }
  /** Streams of one user with the same `credential` share each check; without one, the stream is checked alone. */
  open(
    id: number,
    res: EventStreamResponse,
    check: () => Promise<StreamCredentialResult>,
    credential: string | symbol = Symbol('stream'),
  ): Promise<void> {
    return this.#track(this.#open(id, res, check, credential));
  }
  /** Until the headers go out, a refusal reaches the client as a JSON error. */
  async #open(
    id: number,
    res: EventStreamResponse,
    check: () => Promise<StreamCredentialResult>,
    credential: string | symbol,
  ): Promise<void> {
    if (this.#closed) throw refused();
    const stream: Stream = { res, check, credential, ready: false, revision: -1 };
    const group = this.#join(id, stream);
    res.on('close', () => this.#end(id, group, stream));
    const ended = () => group.retired || !group.streams.has(stream);
    try {
      await this.#enqueue(group, async () => {
        if (ended()) return;
        if (!(await this.#valid(group, stream))) throw refused();
      });
      if (ended()) return;
      const state = await this.#initialState(id, group, ended);
      if (!state) return;
      await this.#enqueue(group, () => this.#start(id, group, stream, state));
    } catch (error) {
      if (ended()) return;
      if (res.headersSent) this.#end(id, group, stream);
      else this.#discard(id, group, stream);
      throw error;
    }
  }
  /** Waits for the user's pending build; undefined when the stream ended meanwhile. A commit may overtake it. */
  async #initialState(id: number, group: Group, ended: () => boolean): Promise<TimerState | undefined> {
    // Registered before the awaited build, so a later stream waits for this one.
    const build = (this.#builds.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (group.retired) throw refused();
        return ended() ? undefined : this.#state(id);
      });
    this.#builds.set(id, build);
    return build.finally(() => {
      if (this.#builds.get(id) === build) this.#builds.delete(id);
    });
  }
  async #start(id: number, group: Group, stream: Stream, state: TimerState): Promise<void> {
    if (!group.streams.has(stream)) return;
    if (!(await this.#valid(group, stream))) throw refused();
    const { res } = stream;
    if (!res.socket || res.socket.destroyed) {
      this.#end(id, group, stream);
      return;
    }
    res.writeHead(200, EVENT_STREAM_HEADERS);
    res.flushHeaders();
    stream.ready = true;
    const current = group.latest && group.latest.revision > state.revision ? group.latest : state;
    stream.revision = current.revision;
    this.#write(id, group, stream, timerEvent(current, reconnectDelay()));
    if (!group.streams.has(stream)) return;
    group.timer ??= setInterval(() => this.#tick(id, group), this.#options.keepAliveMs);
  }
  /** Rechecks each credential once; a stream whose socket is still draining skips the event. */
  #tick(id: number, group: Group): void {
    if (group.ticking) return;
    group.ticking = true;
    const ready = () => [...group.streams].filter(stream => stream.ready);
    void this.#enqueue(group, async () => {
      const streams = ready();
      const passing = await this.#passing(group, streams);
      let behind = -1;
      for (const stream of streams) {
        const result = passing.get(stream);
        if (!result) {
          this.#end(id, group, stream);
          continue;
        }
        if (!stream.draining) this.#write(id, group, stream, KEEP_ALIVE_EVENT);
        if (group.streams.has(stream) && result.revision > Math.max(stream.revision, group.latest?.revision ?? -1))
          behind = Math.max(behind, result.revision);
      }
      // This tick holds the group queue and the refresh delivers through it, so never await here.
      if (behind >= 0) this.#behind(id, behind);
    })
      .finally(() => {
        group.ticking = false;
      })
      .catch(() => {
        for (const stream of ready()) this.#end(id, group, stream);
      });
  }
  /** So the error handler can still answer. */
  #discard(id: number, group: Group, stream: Stream): void {
    this.#forget(id, group, stream);
  }
  #behind(id: number, revision: number): void {
    try {
      this.#onBehind(id, revision);
    } catch {
      /* The next tick asks again. */
    }
  }
  publish(id: number, state: TimerState): Promise<void> {
    const group = this.#users.get(id);
    if (this.#closed || !group || (group.latest && group.latest.revision >= state.revision)) return Promise.resolve();
    group.latest = structuredClone(state);
    return this.#enqueue(group, async () => {
      const due = [...group.streams].filter(stream => stream.ready && stream.revision < state.revision);
      const passing = await this.#passing(group, due);
      const message = timerEvent(state);
      for (const stream of due) {
        if (!passing.has(stream)) {
          this.#end(id, group, stream);
          continue;
        }
        stream.revision = state.revision;
        this.#write(id, group, stream, message);
      }
    });
  }
  hasStreams(id: number): boolean {
    return !this.#closed && !!this.#users.get(id)?.streams.size;
  }
  recheck(id: number): Promise<void> {
    const group = this.#users.get(id);
    if (!group) return Promise.resolve();
    return this.#enqueue(group, async () => {
      const streams = [...group.streams];
      const passing = await this.#passing(group, streams);
      for (const stream of streams) if (!passing.has(stream)) this.#end(id, group, stream);
    });
  }
  forgetUser(id: number): void {
    const group = this.#users.get(id);
    this.#builds.delete(id);
    if (!group) return;
    group.retired = true;
    group.latest = undefined;
    this.#users.delete(id);
    for (const stream of [...group.streams]) this.#end(id, group, stream);
  }
  async closeAll(): Promise<void> {
    this.#closed = true;
    for (const [id, group] of this.#users) for (const stream of [...group.streams]) this.#end(id, group, stream);
    while (this.#pending.size) await Promise.allSettled([...this.#pending]);
  }
}
/** `retry:` goes after `event:` so line-splitting readers still see the type first. */
function timerEvent(state: TimerState, retryMs?: number): string {
  const retry = retryMs === undefined ? '' : `retry: ${retryMs}\n`;
  return `event: timer\n${retry}data: ${JSON.stringify(state)}\n\n`;
}
