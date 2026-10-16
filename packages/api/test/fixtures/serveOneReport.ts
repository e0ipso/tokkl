// Child process for the report worker test in reports.test.ts: serves the app on a file-backed
// database, builds one report (which starts the worker), closes the server and then returns
// without calling process.exit. The process must end on its own.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.ts';
import { openDatabase } from '../../src/db/index.ts';
import { createFirstAdmin } from '../../src/models/users.ts';

const dir = mkdtempSync(join(tmpdir(), 'tokkl-test-'));
const databasePath = join(dir, 'tokkl.db');
const db = openDatabase(databasePath);
const user = await createFirstAdmin(db, { email: 'me@example.com', password: 'correct horse battery', fullname: 'Test User', timezone: 'UTC' });
const config = {
  port: 0, host: '127.0.0.1', dataDir: dir, databasePath, webRoot: '/nonexistent', trustProxy: false, sessionDays: 30, setupCode: undefined,
};
const server = createApp({ db, config, setup: { code: null } }).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/app/report`, {
  method: 'POST',
  headers: { authorization: `Basic ${Buffer.from(`${user.api_token}:api_token`).toString('base64')}` },
  body: JSON.stringify({ start_date: '2026-01-01', end_date: '2026-01-31' }),
});
process.stdout.write(`report ${response.status}\n`);
server.closeAllConnections();
server.close(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write('closed\n');
});
