import { randomInt } from 'node:crypto';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { initializeDatabase } from './storage/migrations.ts';
import { createStorage } from './storage/index.ts';
import { safeDestination } from './storage/config.ts';
function setupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++)
    code += alphabet[randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}
async function main(): Promise<void> {
  const { config, notices } = loadConfig();
  for (const notice of notices)
    console.warn(notice);
  const storage = createStorage(await initializeDatabase(config.storage));
  try {
    const setup = { code: await storage.users.count() === 0 ? config.setupCode ?? setupCode() : null };
    const app = createApp({ storage, config, setup });
    const server = app.listen(config.port, config.host);
    let stopping: Promise<void> | undefined;
    const shutdown = () => stopping ??= (async () => {
      const drained = new Promise<void>(resolve => server.close(() => resolve()));
      const deadline = setTimeout(() => server.closeAllConnections(), 10000);
      deadline.unref();
      try {
        const results = await Promise.allSettled([app.locals.close(), drained]);
        if (results.some(result => result.status === 'rejected'))
          throw new Error('HTTP shutdown failed');
      }
      finally {
        clearTimeout(deadline);
        await storage.close();
      }
    })();
    server.on('error', () => { console.error('HTTP server failed'); process.exitCode = 1; void shutdown().catch(() => { console.error('Shutdown failed'); process.exitCode = 1; }); });
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, () => {
        console.log(`${signal} received, shutting down`);
        void shutdown().catch(() => { console.error('Shutdown failed'); process.exitCode = 1; });
      });
    server.once('listening', () => {
      console.log(`tokkl listening on http://${config.host}:${config.port} (${safeDestination(config.storage)})`);
      if (setup.code)
        console.log(`No admin account yet. Open the web UI and use this setup code to create it: ${setup.code}`);
    });
  }
  catch (error) {
    await storage.close();
    throw error;
  }
}
await main().catch(() => { console.error('Startup failed. Check database configuration, supported schema and connectivity.'); process.exitCode = 1; });
