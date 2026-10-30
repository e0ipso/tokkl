// Child process for the report worker test in reports.test.ts: serves the app on a file-backed
// database, builds one report (which starts the worker), closes the server and then returns
// without calling process.exit. The process must end on its own.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';


const dir = mkdtempSync(join(tmpdir(), 'tokkl-test-'));
const databasePath = join(dir, 'tokkl.db');
const storageConfig={backend:'sqlite' as const,filename:databasePath,busyTimeoutMs:5000};
const storage=createStorage(await initializeDatabase(storageConfig));
const createFirstAdmin=(_storage:typeof storage,body:Record<string,unknown>)=>createAccountOperations(storage,{recheckUser:async()=>{}}).createFirstAdmin(body);
const user = await createFirstAdmin(storage, { email: 'me@example.com', password: 'correct horse battery', fullname: 'Test User', timezone: 'UTC' });
const config = {
  port: 0, host: '127.0.0.1', dataDir: dir, storage:storageConfig, webRoot: '/nonexistent', trustProxy: false, sessionDays: 30, setupCode: undefined,
};
const app=createApp({ storage, config, setup: { code: null } });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/app/report`, {
  method: 'POST',
  headers: { authorization: `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}` },
  body: JSON.stringify({ start_date: '2026-01-01', end_date: '2026-01-31' }),
});
process.stdout.write(`report ${response.status}\n`);
server.closeAllConnections();
server.close(async () => {
  await app.locals.close();
  await storage.close();
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write('closed\n');
});
