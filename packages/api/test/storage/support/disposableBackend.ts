import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { sql } from 'kysely';
import { parseStorageConfig, type Backend, type StorageConfig } from '../../../src/storage/config.ts';
import { openConnection } from '../../../src/storage/connections.ts';
import { images } from './images.ts';

const exec = promisify(execFile);
export interface DisposableBackend { config: StorageConfig; cleanup(): Promise<void> }
/** Never accepts an external URL. Each invocation owns one empty database/container or temp file. */
export async function disposableBackend(backend: Backend): Promise<DisposableBackend> {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-db-'));
  if (backend === 'sqlite') return { config: parseStorageConfig({}, dir), async cleanup() { rmSync(dir, { recursive: true, force: true }); } };
  const name = `tokkl-test-${backend}-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const environment = backend === 'postgres' ? { POSTGRES_PASSWORD: password, POSTGRES_USER: 'tokkl', POSTGRES_DB: 'tokkl_test' }
    : backend === 'mysql' ? { MYSQL_ROOT_PASSWORD: password, MYSQL_USER: 'tokkl', MYSQL_PASSWORD: password, MYSQL_DATABASE: 'tokkl_test' }
    : { MARIADB_ROOT_PASSWORD: password, MARIADB_USER: 'tokkl', MARIADB_PASSWORD: password, MARIADB_DATABASE: 'tokkl_test' };
  let ownedId: string | undefined;
  const cleanup = async () => {
    try { if (ownedId) await exec('docker', ['rm', '-f', '-v', ownedId]); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  };
  try {
    // Values come from the child environment, so credentials never appear in argv or retained logs.
    for (let attempt = 1; ; attempt++) {
      const created = await exec('docker', ['create', '--name', name, '--label', 'com.tokkl.disposable-test=true', '-p', `127.0.0.1::${backend === 'postgres' ? 5432 : 3306}`, ...Object.keys(environment).flatMap(key => ['-e', key]), images[backend], ...(backend === 'mysql' ? ['--log-bin-trust-function-creators=ON'] : [])], { env: { ...process.env, ...environment } });
      ownedId = created.stdout.trim();
      try { await exec('docker', ['start', ownedId]); break; }
      catch (error) {
        // Rootless Docker's allocator can choose a port held by a host process. A fresh
        // container gets a new allocation; always remove the exact failed container first.
        await exec('docker', ['rm', '-f', '-v', ownedId]);
        ownedId = undefined;
        if (attempt >= 5 || !/bind: address already in use/.test(String((error as { stderr?: string }).stderr))) throw error;
      }
    }
    const { stdout } = await exec('docker', ['port', ownedId!, backend === 'postgres' ? '5432/tcp' : '3306/tcp']);
    const port = Number(stdout.trim().split(':').at(-1));
    const config = parseStorageConfig({ TOKKL_DATABASE_URL: `${backend}://tokkl:${password}@127.0.0.1:${port}/tokkl_test?sslmode=disable&connect_timeout_ms=500` }, dir);
    const deadline = Date.now() + 120000;
    for (;;) {
      try {
        const c = await openConnection(config);
        try {
          const result = await sql.raw(backend === 'postgres' ? 'select version() as version' : 'select version() as version').execute(c.db);
          console.log(`${backend} engine: ${String((result.rows[0] as { version: string }).version)}`);
        } finally { await c.close(); }
        return { config, cleanup };
      } catch {
        if (Date.now() >= deadline) throw new Error(`Disposable ${backend} did not become ready`);
        await setTimeout(250);
      }
    }
  } catch (error) { await cleanup(); throw error; }
}
