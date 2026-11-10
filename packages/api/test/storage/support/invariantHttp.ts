import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { HttpApp } from '../../../src/app.ts';
import type { TimerState } from '@tokkl/types';
import type { Storage } from '../../../src/domain/ports.ts';

export const gate = () => Promise.withResolvers<void>();
/**
 * Holds each write at `storage.transaction` until every request in `overlap` arrived, then releases them.
 * On SQLite that is before BEGIN IMMEDIATE, so released writes queue instead of deadlocking.
 */
export function transactionBarrier() {
  let armed: { remaining: number; entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | undefined;
  return {
    wrap: (storage: Storage): Storage => ({
      ...storage,
      async transaction(work, options) {
        const current = armed;
        if (current && current.remaining > 0) {
          if (--current.remaining === 0) current.entered.resolve();
          await current.release.promise;
        }
        return storage.transaction(work, options);
      },
    }),
    async overlap<T>(...requests: Array<() => Promise<T>>): Promise<T[]> {
      const current = (armed = { remaining: requests.length, entered: gate(), release: gate() });
      const work = Promise.all(requests.map(request => request()));
      const deadline = setTimeout(() => current.entered.resolve(), 5000);
      try {
        await current.entered.promise;
        assert.equal(current.remaining, 0, 'every real HTTP request reached its write transaction');
      } finally {
        clearTimeout(deadline);
        current.release.resolve();
        armed = undefined;
      }
      return work;
    },
    release: () => armed?.release.resolve(),
  };
}
export async function serveInvariant(http: HttpApp) {
  const server = http.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async request(method: string, path: string, body?: unknown, token?: string) {
      return fetch(base + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-tokkl-csrf': '1',
          ...(token ? { authorization: `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async close() {
      await http.close();
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}
export async function readTimerStream(response: Response) {
  assert.equal(response.status, 200);
  const reader = response.body!.getReader(),
    states: TimerState[] = [];
  const events: Array<number | 'keep-alive'> = [];
  let ended = false,
    failure: unknown;
  const pump = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += new TextDecoder().decode(chunk.value);
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (event.startsWith('event: timer')) {
            const state = JSON.parse(event.split('data: ')[1]!) as TimerState;
            states.push(state);
            events.push(state.revision);
          } else if (event.startsWith('event: keep-alive')) events.push('keep-alive');
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      ended = true;
    }
  })();
  return {
    states,
    events,
    ended: () => ended,
    async until(
      predicate: () => boolean,
      { timeoutMs = 5000, describe }: { timeoutMs?: number; describe?: () => string } = {},
    ) {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (failure) throw failure;
        if (performance.now() >= deadline) assert.fail(`SSE observation deadline${describe ? `\n${describe()}` : ''}`);
        await new Promise(r => setTimeout(r, 5));
      }
    },
    async close() {
      await reader.cancel();
      await pump;
    },
  };
}
