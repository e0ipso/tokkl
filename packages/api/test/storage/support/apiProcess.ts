import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimerState } from '@tokkl/types';
import type { StorageConfig } from '../../../src/storage/config.ts';

const applicationEntrypoint = fileURLToPath(new URL('../../../src/index.ts', import.meta.url));

export function databaseUrl(config: StorageConfig): string {
  if (config.backend === 'sqlite') return `sqlite://${config.filename}`;
  return `${config.backend}://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?sslmode=disable&connect_timeout_ms=5000`;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const number = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return number;
}

export interface ApiProcess {
  base: string;
  logs(): string;
  stop(): Promise<void>;
  child: ReturnType<typeof spawn>;
}

export async function startApi(url: string, dir: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<ApiProcess> {
  const number = await freePort();
  const base = `http://127.0.0.1:${number}`;
  const child = spawn(process.execPath, [applicationEntrypoint], {
    env: {
      ...process.env,
      PORT: String(number),
      HOST: '127.0.0.1',
      TOKKL_DATABASE_URL: url,
      TOKKL_DATA_DIR: dir,
      TOKKL_SETUP_CODE: 'TEST-CODE',
      TOKKL_WEB_ROOT: join(dir, 'web'),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup deadline')), 30000);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('startup refused'));
    });
    child.stdout!.on('data', chunk => {
      logs += String(chunk);
      if (logs.includes('tokkl listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr!.on('data', chunk => {
      logs += String(chunk);
    });
  });
  return {
    base,
    logs: () => logs,
    stop: async () => {
      child.kill('SIGTERM');
      const code = await exit;
      assert.equal(code, 0, logs);
    },
    child,
  };
}

export async function openTimerStream(base: string, token: string) {
  const response = await fetch(`${base}/api/app/timer/events`, {
    headers: { authorization: `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}` },
  });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const states: TimerState[] = [];
  const keepAlives: number[] = [];
  let ended = false;
  let error: unknown;
  const pump = (async () => {
    let text = '';
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        text += new TextDecoder().decode(result.value);
        let split;
        while ((split = text.indexOf('\n\n')) >= 0) {
          const event = text.slice(0, split);
          text = text.slice(split + 2);
          if (event.startsWith('event: timer')) states.push(JSON.parse(event.split('data: ')[1]!) as TimerState);
          else if (event.startsWith('event: keep-alive')) keepAlives.push(Date.now());
        }
      }
    } catch (e) {
      error = e;
    } finally {
      ended = true;
    }
  })();
  async function until(predicate: () => boolean, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (error) throw error;
      if (Date.now() > deadline) throw Error('stream deadline');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  return {
    states,
    keepAlives,
    until,
    ended: () => ended,
    close: async () => {
      await reader.cancel();
      await pump;
    },
  };
}
