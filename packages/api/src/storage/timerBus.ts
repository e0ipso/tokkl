import pg from 'pg';
import type { ServerConfig, StorageConfig } from './config.ts';
import { postgresOptions } from './connections.ts';
import type { Logger } from '../lib/logger.ts';
import type { TimerBus, TimerSignal } from '../domain/ports.ts';

export type { TimerBus, TimerSignal };
/** Local commits already deliver their own state, so nothing is sent or received. */
export function createLocalTimerBus(): TimerBus {
  return { send() {}, receive() {}, async close() {} };
}

/** Fixed lowercase, so it is safe as a literal in LISTEN. */
export const TIMER_BUS_CHANNEL = 'tokkl_timer_signal';
/** Tells the listener apart from pool connections in pg_stat_activity. */
export const TIMER_BUS_APPLICATION = 'tokkl-timer-bus';
const FIRST_RETRY_MS = 100;
const MAX_RETRY_MS = 5000;

class TimerBusStartError extends Error {
  constructor() {
    super('Timer bus start failed');
    this.name = 'TimerBusStartError';
  }
}

/** Any role that can connect may NOTIFY, so anything but the exact shape is dropped. */
function parseSignal(payload: string | undefined): TimerSignal | undefined {
  let value: unknown;
  try {
    value = JSON.parse(payload ?? '');
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('userId') || !keys.includes('revision')) return undefined;
  const { userId, revision } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(userId) || (userId as number) <= 0) return undefined;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return undefined;
  return { userId: userId as number, revision: revision as number };
}

/** Only PostgreSQL carries signals between processes. */
export function startTimerBus(config: StorageConfig, logger: Logger): Promise<TimerBus> {
  return config.backend === 'postgres' ? startPostgresTimerBus(config, logger) : Promise.resolve(createLocalTimerBus());
}

/** Past the limit the socket is destroyed, so a silent peer cannot keep the process alive. */
function endQuietly(client: pg.Client, limitMs?: number): Promise<void> {
  const ended = client.end().catch(() => {});
  if (limitMs === undefined) return ended;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>(resolve => {
    timer = setTimeout(() => {
      client.connection.stream.destroy();
      resolve();
    }, limitMs);
    timer.unref();
  });
  return Promise.race([ended, expired]).finally(() => clearTimeout(timer));
}

interface ListenerEvents {
  signal(signal: TimerSignal): void;
  lost(client: pg.Client): void;
}

/** A pg.Client never reconnects. */
async function connectListener(
  options: pg.ClientConfig,
  timeoutMs: number,
  events: ListenerEvents,
): Promise<pg.Client> {
  const client = new pg.Client({ ...options, application_name: TIMER_BUS_APPLICATION, keepAlive: true });
  client.on('notification', message => {
    if (message.channel !== TIMER_BUS_CHANNEL) return;
    const signal = parseSignal(message.payload);
    if (signal) events.signal(signal);
  });
  // A connection that drops before it becomes current must not be handed out as live.
  let dropped = false;
  client.on('error', () => {
    dropped = true;
    events.lost(client);
  });
  client.on('end', () => {
    dropped = true;
    events.lost(client);
  });
  let deadline: NodeJS.Timeout | undefined;
  const listening = client.connect().then(() => client.query(`LISTEN ${TIMER_BUS_CHANNEL}`));
  listening.catch(() => {});
  try {
    await Promise.race([
      listening,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new TimerBusStartError()), timeoutMs);
      }),
    ]);
    if (dropped) throw new TimerBusStartError();
    return client;
  } catch {
    void endQuietly(client);
    throw new TimerBusStartError();
  } finally {
    clearTimeout(deadline);
  }
}

/** Reconnects with exponential backoff; signals sent in between are dropped. */
class PostgresTimerBus implements TimerBus {
  private readonly options: pg.ClientConfig;
  private readonly connectTimeoutMs: number;
  private readonly logger: Logger;
  private readonly events: ListenerEvents = {
    signal: signal => {
      if (!this.closed) this.handler?.(signal);
    },
    lost: client => this.lost(client),
  };
  private handler: ((signal: TimerSignal) => void) | undefined;
  private current: pg.Client | undefined;
  private attempt: Promise<void> | undefined;
  private retry: NodeJS.Timeout | undefined;
  private delay = FIRST_RETRY_MS;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(options: pg.ClientConfig, connectTimeoutMs: number, logger: Logger) {
    this.options = options;
    this.connectTimeoutMs = connectTimeoutMs;
    this.logger = logger;
  }

  /** If the first connection fails, startup fails. */
  async start(): Promise<void> {
    this.current = await this.connect();
  }

  send(signal: TimerSignal): void {
    const client = this.current;
    // Signals sent while disconnected are dropped. Heartbeat recovery catches the receivers up.
    if (this.closed || !client) return;
    const payload = JSON.stringify({ userId: signal.userId, revision: signal.revision });
    client.query('SELECT pg_notify($1, $2)', [TIMER_BUS_CHANNEL, payload]).catch(() => {
      if (!this.closed) this.logger.warn('Timer bus send failed');
    });
  }

  receive(handler: (signal: TimerSignal) => void): void {
    this.handler = handler;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      clearTimeout(this.retry);
      this.retry = undefined;
      await this.attempt;
      const client = this.current;
      this.current = undefined;
      if (client) await endQuietly(client, this.connectTimeoutMs);
    })();
    return this.closing;
  }

  private connect(): Promise<pg.Client> {
    return connectListener(this.options, this.connectTimeoutMs, this.events);
  }

  /** Late events from a replaced client are ignored. */
  private lost(client: pg.Client): void {
    if (client !== this.current) return;
    this.current = undefined;
    void endQuietly(client);
    if (this.closed) return;
    this.logger.warn('Timer bus disconnected');
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.attempt = this.reconnect().finally(() => {
        this.attempt = undefined;
      });
    }, this.delay);
    this.delay = Math.min(this.delay * 2, MAX_RETRY_MS);
  }

  private async reconnect(): Promise<void> {
    let client: pg.Client;
    try {
      client = await this.connect();
    } catch {
      this.schedule();
      return;
    }
    if (this.closed) {
      await endQuietly(client, this.connectTimeoutMs);
      return;
    }
    this.current = client;
    this.delay = FIRST_RETRY_MS;
    this.logger.info('Timer bus reconnected');
  }
}

async function startPostgresTimerBus(config: ServerConfig, logger: Logger): Promise<TimerBus> {
  // Pool-only fields do not apply to a single client. Never log these options: they hold credentials.
  const { max: _max, idleTimeoutMillis: _idle, ...options } = postgresOptions(config, false);
  const bus = new PostgresTimerBus(options, config.connectTimeoutMs, logger);
  await bus.start();
  return bus;
}
