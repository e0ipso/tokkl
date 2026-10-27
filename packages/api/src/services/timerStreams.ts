import type { TimerState } from '@tokkl/types';
import type { Response } from 'express';
import type { Db } from '../db/index.ts';
import { forbidden } from '../lib/errors.ts';
import { getUser } from '../models/users.ts';
import { subscribeTimer } from './timerHub.ts';
import { getTimerState } from './timerState.ts';

export interface TimerStreamOptions {
  /** Milliseconds between keep-alive comments. Proxies close streams that stay silent for long. */
  keepAliveMs?: number;
  /** Streams one user may hold open. Opening one more closes that user's oldest. */
  maxPerUser?: number;
}

/** One open stream: the response it writes to and the check its credential must keep passing. */
interface Stream {
  readonly res: Response;
  readonly check: () => boolean;
  keepAlive?: NodeJS.Timeout;
}

/** A user's open streams, oldest first, and the hub subscription they share. */
interface UserStreams {
  readonly streams: Set<Stream>;
  readonly unsubscribe: () => void;
  /** True while a publish builds the state, so the publish its own settlement may cause is skipped. */
  publishing: boolean;
}

const KEEP_ALIVE_MS = 25_000;
const MAX_STREAMS_PER_USER = 10;

/**
 * The open `GET /api/app/timer/events` streams of one database, as Server-Sent Events. Each sends
 * the full timer state as a `timer` event on connect and after every committed change for its
 * user, and a comment line every `keepAliveMs`. Before each send and on each keep-alive tick the
 * stream's credential check runs, and a stream whose check fails ends.
 */
export class TimerStreams {
  readonly #db: Db;
  readonly #keepAliveMs: number;
  readonly #maxPerUser: number;
  readonly #users = new Map<number, UserStreams>();

  constructor(db: Db, { keepAliveMs = KEEP_ALIVE_MS, maxPerUser = MAX_STREAMS_PER_USER }: TimerStreamOptions = {}) {
    this.#db = db;
    this.#keepAliveMs = keepAliveMs;
    this.#maxPerUser = maxPerUser;
  }

  /**
   * Starts a stream for `userId` on `res` and sends the current state. `check` tells whether the
   * request's credential still signs it in. The check runs and the state is read before the
   * headers go out, so a refusal or an error still gets the normal JSON error reply.
   */
  open(userId: number, res: Response, check: () => boolean): void {
    const state = this.#check(check) ? this.#state(userId) : undefined;
    if (state === undefined) throw forbidden('Incorrect username and/or password');
    // The client may have gone while the request was authenticated; its close event has passed.
    if (!res.socket || res.socket.destroyed) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      // nginx buffers proxied responses unless told not to, which would hold events back.
      'X-Accel-Buffering': 'no',
      // The connection ends with the stream, so a server shutting down has no idle socket to wait on.
      Connection: 'close',
    });
    res.flushHeaders();
    res.write(timerEvent(state));

    const stream: Stream = { res, check };
    const group = this.#users.get(userId) ?? this.#subscribe(userId);
    group.streams.add(stream);
    stream.keepAlive = setInterval(() => this.#keepAliveTick(userId, stream), this.#keepAliveMs);
    res.on('close', () => this.#remove(userId, stream));
    for (const oldest of group.streams) {
      if (group.streams.size <= this.#maxPerUser) break;
      this.#end(userId, oldest);
    }
  }

  /**
   * Runs the credential check of every stream `userId` has open and ends those that fail. Call it
   * after a change that may end a credential.
   */
  recheck(userId: number): void {
    for (const stream of this.#users.get(userId)?.streams ?? []) {
      if (!this.#check(stream.check)) this.#end(userId, stream);
    }
  }

  /** Ends every open stream, so the server can close. */
  closeAll(): void {
    for (const [userId, group] of this.#users) {
      for (const stream of group.streams) this.#end(userId, stream);
    }
  }

  #subscribe(userId: number): UserStreams {
    const group: UserStreams = {
      streams: new Set(),
      unsubscribe: subscribeTimer(this.#db, userId, () => this.#publish(userId)),
      publishing: false,
    };
    this.#users.set(userId, group);
    return group;
  }

  /**
   * Sends one fresh state to every stream of `userId` that still passes its check. The state is
   * built once for them all. Building it settles the timer, which may commit and publish again;
   * that inner publish is skipped, since the state built here already holds its change.
   */
  #publish(userId: number): void {
    const group = this.#users.get(userId);
    if (!group || group.publishing) return;
    const passing = [...group.streams].filter((stream) => {
      if (this.#check(stream.check)) return true;
      this.#end(userId, stream);
      return false;
    });
    if (passing.length === 0) return;
    group.publishing = true;
    let state: TimerState | undefined;
    try {
      state = this.#state(userId);
    } finally {
      group.publishing = false;
    }
    if (state === undefined) {
      for (const stream of passing) this.#end(userId, stream);
      return;
    }
    const message = timerEvent(state);
    for (const stream of passing) stream.res.write(message);
  }

  #keepAliveTick(userId: number, stream: Stream): void {
    if (this.#check(stream.check)) stream.res.write(': keep-alive\n\n');
    else this.#end(userId, stream);
  }

  /** The state of `userId` as their current row describes it, or undefined once the account is gone. */
  #state(userId: number): TimerState | undefined {
    const user = getUser(this.#db, userId);
    return user ? getTimerState(this.#db, user) : undefined;
  }

  /** A check that throws, for example on a closed database, fails like one that returns false. */
  #check(check: () => boolean): boolean {
    try {
      return check();
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  #end(userId: number, stream: Stream): void {
    this.#remove(userId, stream);
    stream.res.end();
  }

  /** Forgets `stream` and stops its keep-alive. The last stream of a user also drops the hub subscription. */
  #remove(userId: number, stream: Stream): void {
    clearInterval(stream.keepAlive);
    const group = this.#users.get(userId);
    if (!group?.streams.delete(stream)) return;
    if (group.streams.size > 0) return;
    group.unsubscribe();
    this.#users.delete(userId);
  }
}

/** One `timer` event. JSON.stringify without indentation keeps the state on one `data:` line. */
function timerEvent(state: TimerState): string {
  return `event: timer\ndata: ${JSON.stringify(state)}\n\n`;
}
