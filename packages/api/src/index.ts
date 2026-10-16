import { randomInt } from 'node:crypto';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';
import { countUsers } from './models/users.ts';

function setupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += alphabet[randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

const { config, notices } = loadConfig();
for (const notice of notices) console.warn(notice);
const db = openDatabase(config.databasePath);
const setup = { code: countUsers(db) === 0 ? (config.setupCode ?? setupCode()) : null };
const app = createApp({ db, config, setup });

const server = app.listen(config.port, config.host, () => {
  console.log(`tokkl listening on http://${config.host}:${config.port} (database: ${config.databasePath})`);
  if (setup.code) {
    console.log(`No admin account yet. Open the web UI and use this setup code to create it: ${setup.code}`);
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
