import { spawn } from 'node:child_process';
import { disposableBackend } from '../packages/api/test/storage/support/disposableBackend.ts';
import { browserBackend, disposableDatabaseUrl } from './backend-options.ts';

const backend = browserBackend(process.env);
let stopped = false;
let child: ReturnType<typeof spawn> | undefined;
const stop = () => { stopped = true; child?.kill('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const fixture = await disposableBackend(backend);
try {
  if (!stopped) {
    // Browser concurrency uses the production connection timeout, including under native build load.
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, connectTimeoutMs: 5000 };
    const databaseUrl = disposableDatabaseUrl(config);
    child = spawn(process.execPath, ['packages/api/src/index.ts'], {
      env: { ...process.env, TOKKL_DATABASE_URL: databaseUrl }, stdio: 'inherit',
    });
    const exit = await new Promise<number>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('exit', (code, signal) => resolve(code ?? (stopped && signal === 'SIGTERM' ? 0 : 1)));
    });
    process.exitCode = exit;
  }
} finally {
  await fixture.cleanup();
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
