import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The matrix owns its databases. No operator target is forwarded to a writable fixture.
if (process.env.TOKKL_DATABASE_URL !== undefined || process.env.TOKKL_TEST_DATABASE_URL !== undefined) {
  throw Error('Operator database targets are forbidden in the backend matrix');
}
const cwd = fileURLToPath(new URL('..', import.meta.url));
let interrupted = false;

async function run(label: string, pattern: string, backend = 'sqlite'): Promise<void> {
  console.log(`Backend suite: ${label}`);
  const argv = [process.execPath, '--test', '--test-concurrency=2', '--test-reporter=spec', pattern];
  console.log(JSON.stringify({ event: 'backend-command', label, argv, cwd, backend }));
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd, env: { ...process.env, TOKKL_TEST_BACKEND: backend }, stdio: 'inherit',
  });
  const signal = () => { interrupted = true; child.kill('SIGTERM'); };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    console.log(JSON.stringify({ event: 'backend-exit', label, argv, cwd, exit: code }));
    if (code !== 0 || interrupted) throw Error(`${label} suite failed (exit ${code})`);
  } finally {
    process.off('SIGTERM', signal);
    process.off('SIGINT', signal);
  }
}

const suites = ['sqlite', 'postgres', 'mysql', 'mariadb', 'storage'];
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--suite' || !suites.includes(args[1]!))) {
  throw Error('Expected --suite sqlite|postgres|mysql|mariadb|storage, or no arguments for the full matrix');
}
const selected = args.length ? args[1] : undefined;
const failures: unknown[] = [];
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb']) {
  if (selected && selected !== backend) continue;
  try { await run(backend, 'test/*.test.ts', backend); }
  catch (error) { failures.push(error); }
  if (interrupted) break;
}
if (!interrupted && (!selected || selected === 'storage')) {
  try { await run('repository, concurrency, migration and lifecycle matrices', 'test/storage/*.test.ts'); }
  catch (error) { failures.push(error); }
}
if (failures.length) throw new AggregateError(failures, 'Backend matrix failed');
