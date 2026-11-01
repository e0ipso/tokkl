import pg from 'pg';
import { createLocalTimerBus, type TimerBus, type TimerSignal } from '../domain/timerBus.ts';
import type { ServerConfig, StorageConfig } from './config.ts';
import { postgresOptions } from './connections.ts';

/** Fixed lowercase identifier, so it is safe as a literal in LISTEN. */
export const TIMER_BUS_CHANNEL = 'tokkl_timer_signal';
/** Tells the listener connection apart from pool connections in pg_stat_activity. */
export const TIMER_BUS_APPLICATION = 'tokkl-timer-bus';
const FIRST_RETRY_MS = 100;
const MAX_RETRY_MS = 5000;

class TimerBusStartError extends Error {
  constructor() {
    super('Timer bus start failed');
    this.name = 'TimerBusStartError';
  }
}

/** Any role that can connect may NOTIFY on the channel, so anything but the exact shape is dropped. */
function parseSignal(payload: string | undefined): TimerSignal | undefined {
  let value: unknown;
  try { value = JSON.parse(payload ?? ''); } catch { return undefined; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('userId') || !keys.includes('revision')) return undefined;
  const { userId, revision } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(userId) || (userId as number) <= 0) return undefined;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return undefined;
  return { userId: userId as number, revision: revision as number };
}

/** PostgreSQL carries signals between processes. The other engines run one process's local bus. */
export function startTimerBus(config: StorageConfig): Promise<TimerBus> {
  return config.backend === 'postgres' ? startPostgresTimerBus(config) : Promise.resolve(createLocalTimerBus());
}

/** A graceful end waits for the server. Past the limit the socket is destroyed, so a silent peer
 * cannot keep the process alive. */
function endQuietly(client: pg.Client, limitMs?: number): Promise<void> {
  const ended = client.end().catch(() => {});
  if (limitMs === undefined) return ended;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>(resolve => {
    timer = setTimeout(() => { client.connection.stream.destroy(); resolve(); }, limitMs);
    timer.unref();
  });
  return Promise.race([ended, expired]).finally(() => clearTimeout(timer));
}

async function startPostgresTimerBus(config: ServerConfig): Promise<TimerBus> {
  // Pool-only fields do not apply to a single client. Never log these options: they hold credentials.
  const { max: _max, idleTimeoutMillis: _idle, ...options } = postgresOptions(config, false);
  let handler: ((signal: TimerSignal) => void) | undefined;
  let current: pg.Client | undefined;
  let attempt: Promise<void> | undefined;
  let retry: NodeJS.Timeout | undefined;
  let delay = FIRST_RETRY_MS;
  let closed = false;
  let closing: Promise<void> | undefined;

  /** Connects one fresh client and LISTENs, within the connect timeout. A pg.Client never reconnects. */
  async function open(): Promise<pg.Client> {
    const client = new pg.Client({ ...options, application_name: TIMER_BUS_APPLICATION, keepAlive: true });
    client.on('notification', message => {
      if (closed || message.channel !== TIMER_BUS_CHANNEL) return;
      const signal = parseSignal(message.payload);
      if (signal) handler?.(signal);
    });
    // A connection that drops before it becomes current must not be handed out as live.
    let dropped = false;
    client.on('error', () => { dropped = true; lost(client); });
    client.on('end', () => { dropped = true; lost(client); });
    let deadline: NodeJS.Timeout | undefined;
    const listening = client.connect().then(() => client.query(`LISTEN ${TIMER_BUS_CHANNEL}`));
    listening.catch(() => {});
    try {
      await Promise.race([listening, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new TimerBusStartError()), config.connectTimeoutMs);
      })]);
      if (dropped) throw new TimerBusStartError();
      return client;
    } catch {
      void endQuietly(client);
      throw new TimerBusStartError();
    } finally { clearTimeout(deadline); }
  }

  /** Only the live client may start a reconnect; late events from a replaced one are ignored. */
  function lost(client: pg.Client): void {
    if (client !== current) return;
    current = undefined;
    void endQuietly(client);
    if (closed) return;
    console.warn('Timer bus disconnected');
    schedule();
  }

  function schedule(): void {
    if (closed || retry) return;
    retry = setTimeout(() => { retry = undefined; attempt = reconnect().finally(() => { attempt = undefined; }); }, delay);
    delay = Math.min(delay * 2, MAX_RETRY_MS);
  }

  async function reconnect(): Promise<void> {
    let client: pg.Client;
    try { client = await open(); } catch { schedule(); return; }
    if (closed) { await endQuietly(client, config.connectTimeoutMs); return; }
    current = client;
    delay = FIRST_RETRY_MS;
    console.log('Timer bus reconnected');
  }

  current = await open();
  return {
    send(signal) {
      const client = current;
      // Signals sent while disconnected are dropped. Heartbeat recovery catches the receivers up.
      if (closed || !client) return;
      const payload = JSON.stringify({ userId: signal.userId, revision: signal.revision });
      client.query('SELECT pg_notify($1, $2)', [TIMER_BUS_CHANNEL, payload]).catch(() => {
        if (!closed) console.warn('Timer bus send failed');
      });
    },
    receive(next) { handler = next; },
    close() {
      closing ??= (async () => {
        closed = true;
        clearTimeout(retry);
        retry = undefined;
        await attempt;
        const client = current;
        current = undefined;
        if (client) await endQuietly(client, config.connectTimeoutMs);
      })();
      return closing;
    },
  };
}
