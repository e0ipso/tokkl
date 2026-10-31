import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { TimerState } from '@tokkl/types';

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
export async function serveInvariant(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async request(method: string, path: string, body?: unknown, token?: string) {
      return fetch(base + path, {
        method, headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1',
          ...(token ? { authorization: `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async close() {
      await app.locals.close();
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}
export async function readTimerStream(response: Response) {
  assert.equal(response.status, 200);
  const reader = response.body!.getReader(), states: TimerState[] = [];
  let ended = false, failure: unknown;
  const pump = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += new TextDecoder().decode(chunk.value);
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (event.startsWith('event: timer')) states.push(JSON.parse(event.split('data: ')[1]!) as TimerState);
        }
      }
    } catch (error) { failure = error; }
    finally { ended = true; }
  })();
  return {
    states, ended: () => ended,
    async until(predicate: () => boolean) {
      const deadline = performance.now() + 5000;
      while (!predicate()) {
        if (failure) throw failure;
        assert.ok(performance.now() < deadline, 'SSE observation deadline');
        await new Promise(r => setTimeout(r, 5));
      }
    },
    async close() { await reader.cancel(); await pump; },
  };
}
