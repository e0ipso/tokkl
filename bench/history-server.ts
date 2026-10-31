import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { disposableBackend, type DisposableBackend } from '../packages/api/test/storage/support/disposableBackend.ts';
import type { Backend, StorageConfig } from '../packages/api/src/storage/config.ts';
import { historyEnvironment } from './history-options.ts';
import { HistoryFailure, withHistoryCleanup } from './history-errors.ts';

export class Server {
  readonly base: string;
  readonly config: StorageConfig;
  readonly cleanupEvidence: { directory: string; sqlite_directory?: string; database_namespace?: string; server_pid: number | undefined; exit?: number | null; signal?: string | null; removed?: boolean };
  private child: ChildProcess;
  private fixture: DisposableBackend;
  private dataDir: string;
  private exited: Promise<{ code: number | null; signal: string | null }>;
  private stopping?: Promise<void>;
  private startError?: Error;

  private constructor(child: ChildProcess, fixture: DisposableBackend, directory: string, port: number) {
    this.base = `http://127.0.0.1:${port}`;
    this.config = fixture.config;
    this.child = child;
    this.fixture = fixture;
    this.dataDir = directory;
    this.cleanupEvidence = { directory, server_pid: child.pid, ...(fixture.config.backend === 'sqlite' ? { sqlite_directory: dirname(fixture.config.filename) } : { database_namespace: fixture.config.database }) };
    this.exited = new Promise((resolve, reject) => {
      child.once('error', () => { this.startError = new Error('Benchmark API child could not start'); reject(this.startError); });
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    // Failed spawns can reject before the readiness loop reaches owned cleanup.
    void this.exited.catch(() => {});
  }

  static async start(backend: Backend, port: number, setupCode: string): Promise<Server> {
    // Refuse an occupied application port before sending any HTTP request to it.
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error('Benchmark application port is unavailable')));
      probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
    });
    const fixture = await disposableBackend(backend);
    const directory = mkdtempSync(join(tmpdir(), 'tokkl-bench-'));
    let server: Server | undefined;
    try {
      const child = spawn(process.execPath, ['packages/api/src/index.ts'], {
        env: historyEnvironment(process.env, fixture.config, directory, port, setupCode), stdio: ['ignore', 'pipe', 'ignore'],
      });
      server = new Server(child, fixture, directory, port);
      let listening = false;
      child.stdout!.on('data', chunk => { if (String(chunk).includes('tokkl listening on ')) listening = true; });
      for (let attempt = 0; attempt < 300; attempt++) {
        if (server.startError) throw server.startError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Benchmark API child exited before readiness');
        if (listening && (await fetch(`${server.base}/healthz`, { signal: AbortSignal.timeout(5000) })).ok) return server;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Benchmark API did not become ready');
    } catch (error) {
      try {
        return await withHistoryCleanup(async (): Promise<never> => { throw error; }, async () => {
          if (server) await server.stop();
          else { try { await fixture.cleanup(); } finally { rmSync(directory, { recursive: true, force: true }); } }
        });
      } catch (failure) {
        if (failure instanceof HistoryFailure) failure.api_cleanup = server?.cleanupEvidence ?? { directory, server_pid: undefined };
        throw failure;
      }
    }
  }

  stop(): Promise<void> {
    return this.stopping ??= this.close();
  }

  private async close(): Promise<void> {
    let forced = false;
    const deadline = setTimeout(() => { forced = true; this.child.kill('SIGKILL'); }, 35000);
    try {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
      const result = await this.exited;
      Object.assign(this.cleanupEvidence, { exit: result.code, signal: result.signal });
      if (forced || result.code !== 0) throw new Error('Benchmark API did not shut down cleanly');
    } finally {
      clearTimeout(deadline);
      try { await this.fixture.cleanup(); this.cleanupEvidence.removed = true; }
      finally { rmSync(this.dataDir, { recursive: true, force: true }); }
    }
  }
}
