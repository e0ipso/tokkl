import type { TimerState } from '@tokkl/types';
import type { Response } from 'express';
import type { StreamCredentialResult } from '../auth/storageMiddleware.ts';
import { forbidden } from '../lib/errors.ts';
export interface TimerStreamOptions {
  keepAliveMs?: number;
  maxPerUser?: number;
  /** Called, never awaited, when a keep-alive check reads a revision newer than this process delivered. */
  onBehind?: (id: number, revision: number) => void;
}
interface Stream {
  res: Response;
  check: () => Promise<StreamCredentialResult>;
  ready: boolean;
  revision: number;
  timer?: NodeJS.Timeout;
  ticking: boolean;
}
interface Group {
  streams: Set<Stream>;
  queue: Promise<void>;
  latest?: TimerState;
  retired?: boolean;
}
/** Process-local delivery of committed states. Credential checks serialize per user. */
export class TimerStreams {
  readonly #state: (id: number) => Promise<TimerState>;
  readonly #users = new Map<number, Group>();
  readonly #builds = new Map<number, Promise<TimerState>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #options: Required<Omit<TimerStreamOptions, 'onBehind'>>;
  readonly #onBehind: (id: number, revision: number) => void;
  #closed = false;
  constructor(state: (id: number) => Promise<TimerState>, options: TimerStreamOptions = {}) {
    this.#state = state;
    this.#options = { keepAliveMs: options.keepAliveMs ?? 25000, maxPerUser: options.maxPerUser ?? 10 };
    this.#onBehind = options.onBehind ?? (() => {});
  }
  #group(id: number): Group {
    let group = this.#users.get(id);
    if (!group) {
      group = { streams: new Set(), queue: Promise.resolve() };
      this.#users.set(id, group);
    }
    return group;
  }
  #track<T>(work: Promise<T>): Promise<T> {
    this.#pending.add(work);
    void work.then(() => this.#pending.delete(work), () => this.#pending.delete(work));
    return work;
  }
  #enqueue(group: Group, work: () => Promise<void>): Promise<void> {
    const next = group.queue.then(work);
    group.queue = next.catch(() => { });
    return this.#track(next);
  }
  /** The passing check result, or undefined when the stream must not receive anything. */
  async #valid(group: Group, stream: Stream): Promise<Extract<StreamCredentialResult, { valid: true }> | undefined> {
    try {
      if (this.#closed || group.retired || stream.res.destroyed) return undefined;
      const result = await stream.check();
      return result.valid && !this.#closed && !group.retired && group.streams.has(stream) && !stream.res.destroyed ? result : undefined;
    }
    catch {
      return undefined;
    }
  }
  #end(id: number, group: Group, stream: Stream): void {
    clearInterval(stream.timer);
    group.streams.delete(stream);
    try {
      stream.res.end();
    }
    catch { /* A broken subscriber cannot suppress another. */ }
    if (!group.streams.size && this.#users.get(id) === group)
      this.#users.delete(id);
  }
  #write(id: number, group: Group, stream: Stream, message: string): void {
    if (group.retired || !group.streams.has(stream)) return;
    try {
      if (!stream.res.write(message))
        this.#end(id, group, stream);
    }
    catch {
      this.#end(id, group, stream);
    }
  }
  open(id: number, res: Response, check: () => Promise<StreamCredentialResult>): Promise<void> {
    return this.#track(this.#open(id, res, check));
  }
  async #open(id: number, res: Response, check: () => Promise<StreamCredentialResult>): Promise<void> {
    if (this.#closed)
      throw forbidden('Incorrect username and/or password');
    const group = this.#group(id);
    const stream: Stream = { res, check, ready: false, revision: -1, ticking: false };
    group.streams.add(stream);
    res.on('close', () => this.#end(id, group, stream));
    try {
      await this.#enqueue(group, async () => {
        if (!await this.#valid(group, stream)) throw forbidden('Incorrect username and/or password');
      });
      if (group.retired) return;
      // Register before the awaited build. A commit may overtake this initial snapshot.
      const build = (this.#builds.get(id) ?? Promise.resolve()).catch(() => { }).then(() => {
        if (group.retired) throw forbidden('Incorrect username and/or password');
        return this.#state(id);
      });
      this.#builds.set(id, build);
      const state = await build.finally(() => { if (this.#builds.get(id) === build)
        this.#builds.delete(id); });
      await this.#enqueue(group, async () => {
        if (!group.streams.has(stream))
          return;
        if (!await this.#valid(group, stream))
          throw forbidden('Incorrect username and/or password');
        if (!res.socket || res.socket.destroyed) {
          this.#end(id, group, stream);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'close' });
        res.flushHeaders();
        stream.ready = true;
        const current = group.latest && group.latest.revision > state.revision ? group.latest : state;
        stream.revision = current.revision;
        this.#write(id, group, stream, timerEvent(current));
        if (!group.streams.has(stream))
          return;
        stream.timer = setInterval(() => {
          if (stream.ticking)
            return;
          stream.ticking = true;
          void this.#enqueue(group, async () => {
            if (!group.streams.has(stream))
              return;
            const result = await this.#valid(group, stream);
            if (!result) {
              this.#end(id, group, stream);
              return;
            }
            this.#write(id, group, stream, 'event: keep-alive\ndata:\n\n');
            // This tick holds the group queue and the refresh delivers through it, so never await here.
            if (group.streams.has(stream) && result.revision > Math.max(stream.revision, group.latest?.revision ?? -1))
              this.#behind(id, result.revision);
          }).finally(() => { stream.ticking = false; }).catch(() => this.#end(id, group, stream));
        }, this.#options.keepAliveMs);
        for (const oldest of group.streams) {
          if (group.streams.size <= this.#options.maxPerUser)
            break;
          this.#end(id, group, oldest);
        }
      });
    }
    catch (error) {
      if (group.retired) return;
      if (res.headersSent)
        this.#end(id, group, stream);
      else {
        clearInterval(stream.timer);
        group.streams.delete(stream);
        if (!group.streams.size && this.#users.get(id) === group)
          this.#users.delete(id);
      }
      throw error;
    }
  }
  #behind(id: number, revision: number): void {
    try {
      this.#onBehind(id, revision);
    }
    catch { /* The next tick asks again. */ }
  }
  publish(id: number, state: TimerState): Promise<void> {
    const group = this.#users.get(id);
    if (this.#closed || !group || (group.latest && group.latest.revision >= state.revision))
      return Promise.resolve();
    group.latest = structuredClone(state);
    return this.#enqueue(group, async () => {
      for (const stream of [...group.streams]) {
        if (!stream.ready || stream.revision >= state.revision)
          continue;
        if (!await this.#valid(group, stream)) {
          this.#end(id, group, stream);
          continue;
        }
        stream.revision = state.revision;
        this.#write(id, group, stream, timerEvent(state));
      }
    });
  }
  /** True while this process holds at least one open or opening stream for the user. */
  hasStreams(id: number): boolean {
    return !this.#closed && !!this.#users.get(id)?.streams.size;
  }
  recheck(id: number): Promise<void> {
    const group = this.#users.get(id);
    if (!group)
      return Promise.resolve();
    return this.#enqueue(group, async () => {
      for (const stream of [...group.streams])
        if (!await this.#valid(group, stream))
          this.#end(id, group, stream);
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
    for (const [id, group] of this.#users)
      for (const stream of [...group.streams])
        this.#end(id, group, stream);
    while (this.#pending.size)
      await Promise.allSettled([...this.#pending]);
  }
}
function timerEvent(state: TimerState): string { return `event: timer\ndata: ${JSON.stringify(state)}\n\n`; }
