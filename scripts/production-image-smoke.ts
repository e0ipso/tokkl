import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { images } from '../packages/api/test/storage/support/images.ts';

const exec = promisify(execFile);
const args = process.argv.slice(2);
assert.equal(args[0], '--image', 'Usage: npm run test:container -- --image IMAGE [--backend sqlite|postgres|mysql|mariadb]');
const image = args[1];
assert.ok(image && !image.startsWith('-'), 'A built production image is required');
const backends = ['sqlite', 'postgres', 'mysql', 'mariadb'] as const;
assert.ok(args.length === 2 || (args.length === 4 && args[2] === '--backend' && backends.some(b => b === args[3])), 'Invalid backend selection');
assert.equal(process.env.TOKKL_DATABASE_URL, undefined, 'Operator database targets are forbidden');
assert.equal(process.env.TOKKL_TEST_DATABASE_URL, undefined, 'Operator database targets are forbidden');

const secrets: string[] = [];
const redact = (value: string) => secrets.reduce((s, secret) => s.replaceAll(secret, '[redacted]'), value);
function event(name: string, data: unknown): void { console.log(redact(JSON.stringify({ event: name, data }))); }
async function docker(argv: string[], environment: NodeJS.ProcessEnv = {}): Promise<string> {
  const started = performance.now();
  try {
    const result = await exec('docker', argv, { env: { ...process.env, ...environment }, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    event('docker-command', { argv, cwd: process.cwd(), exit: 0, durationMs: performance.now() - started });
    return (argv[0] === 'logs' ? result.stdout + result.stderr : result.stdout).trim();
  } catch (error) {
    const e = error as { code?: string | number; stderr?: string };
    event('docker-command', { argv, cwd: process.cwd(), exit: e.code, durationMs: performance.now() - started, stderr: redact(e.stderr ?? '') });
    throw Error(`Docker command failed: ${argv[0]}`);
  }
}
async function until(check: () => Promise<boolean>, label: string, timeout = 120000): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!await check()) { assert.ok(performance.now() < deadline, `${label} deadline`); await delay(250); }
}

for (const backend of backends.filter(b => !args[3] || b === args[3])) {
  const namespace = `tokkl-image-${backend}-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const setupCode = randomBytes(12).toString('hex');
  secrets.push(password, setupCode);
  let network: string | undefined, volume: string | undefined, service: string | undefined, app: string | undefined;
  const streams: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const requests: Promise<unknown>[] = [];
  const cleanupErrors: string[] = [];
  let passed = false;
  event('namespace-created', { namespace, backend, owner: process.pid });
  try {
    network = await docker(['network', 'create', namespace]);
    volume = await docker(['volume', 'create', namespace]);
    const serviceEnvironment = backend === 'postgres' ? { POSTGRES_USER: 'tokkl', POSTGRES_PASSWORD: password, POSTGRES_DB: 'tokkl_test' }
      : backend === 'mysql' ? { MYSQL_USER: 'tokkl', MYSQL_PASSWORD: password, MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: 'tokkl_test' }
      : { MARIADB_USER: 'tokkl', MARIADB_PASSWORD: password, MARIADB_ROOT_PASSWORD: password, MARIADB_DATABASE: 'tokkl_test' };
    if (backend !== 'sqlite') {
      service = await docker(['create', '--network', network, '--network-alias', 'db', ...Object.keys(serviceEnvironment).flatMap(key => ['-e', key]), images[backend], ...(backend === 'mysql' ? ['--log-bin-trust-function-creators=ON'] : [])], serviceEnvironment);
      event('container-created', { namespace, role: 'database', id: service, image: images[backend] });
      await docker(['start', service]);
    }
    async function query(statement: string): Promise<string> {
      assert.ok(service);
      return backend === 'postgres'
        ? docker(['exec', service, 'psql', '-h', '127.0.0.1', '-U', 'tokkl', '-d', 'tokkl_test', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement])
        : docker(['exec', '-e', 'MYSQL_PWD', service, backend === 'mysql' ? 'mysql' : 'mariadb', '--protocol=TCP', '-h127.0.0.1', '-uroot', '-Nse', statement], { MYSQL_PWD: password });
    }
    if (service && backend !== 'sqlite') {
      await until(async () => { try { return (await query('SELECT 1')).trim() === '1'; } catch { return false; } }, 'database readiness');
      const version = await query('SELECT version()');
      assert.match(version, backend === 'postgres' ? /^PostgreSQL 18\.6 / : backend === 'mysql' ? /^8\.4\.13$/ : /^11\.8\.9-MariaDB/);
      const details = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .}}', images[backend]]));
      event('database-image', { backend, version, id: details.Id, digests: details.RepoDigests, architecture: details.Architecture });
      if (backend === 'mysql') assert.equal(await query('SELECT @@log_bin_trust_function_creators'), '1');
    }
    const url = backend === 'sqlite' ? 'sqlite:///data/tokkl.sqlite' : `${backend}://tokkl:${password}@db:${backend === 'postgres' ? 5432 : 3306}/tokkl_test?sslmode=disable&connect_timeout_ms=5000`;
    secrets.push(url);
    const environment = { TOKKL_DATABASE_URL: url, TOKKL_SETUP_CODE: setupCode, HOST: '0.0.0.0' };
    app = await docker(['create', '--network', network, '-p', '127.0.0.1::8080', '--mount', `type=volume,src=${volume},dst=/data`, '--health-interval=1s', '--health-start-period=1s', ...Object.keys(environment).flatMap(key => ['-e', key]), image], environment);
    event('container-created', { namespace, role: 'application', id: app, image });
    await docker(['start', app]);
    let base = '';
    async function healthy(): Promise<void> {
      base = `http://${await docker(['port', app!, '8080/tcp'])}`;
      await until(async () => {
        const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', app!]));
        assert.ok(state.Running, 'Application exited before becoming healthy');
        return state.Health.Status === 'healthy';
      }, 'production health');
      assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
    }
    await healthy();
    const runtime = JSON.parse(await docker(['exec', app, 'node', '--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; import { createRequire } from 'node:module'; import { readFileSync, realpathSync } from 'node:fs'; import assert from 'node:assert/strict'; const require=createRequire(new URL('./packages/api/package.json', 'file:///app/')); for(const name of ['pg','mysql2','kysely']) require.resolve(name); for(const name of ['better-sqlite3','sqlite3','typescript','vite']) { try { require.resolve(name); throw Error('Unexpected production dependency '+name); } catch(e) { if(e.code!=='MODULE_NOT_FOUND') throw e; } } assert.ok(realpathSync('node_modules/@tokkl/common').startsWith('/app/packages/')); console.log(JSON.stringify({node:process.version,arch:process.arch,sqlite:new DatabaseSync(':memory:').prepare('select sqlite_version() as v').get().v,drivers:Object.fromEntries(['pg','mysql2','kysely'].map(name=>[name,JSON.parse(readFileSync('/app/node_modules/'+name+'/package.json','utf8')).version]))}));`]));
    event('production-runtime', runtime);
    const html = await fetch(base + '/'); assert.equal(html.status, 200); assert.match(await html.text(), /<html/);
    assert.deepEqual(await (await fetch(base + '/api/app/status')).json(), { setup_required: true });
    const setup = await fetch(base + '/api/app/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1' }, body: JSON.stringify({ email: 'image@example.test', password, fullname: 'Image smoke', timezone: 'UTC', setup_code: setupCode }) });
    assert.equal(setup.status, 200);
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const meResponse = await fetch(base + '/api/v9/me', { headers: { cookie } }); assert.equal(meResponse.status, 200);
    const me = await meResponse.json() as { id: number; api_token: string; default_workspace_id: number };
    secrets.push(me.api_token, cookie);
    const auth = `Basic ${Buffer.from(`${me.api_token}:api_token`).toString('base64')}`; secrets.push(auth);
    const headers = { authorization: auth, 'x-tokkl-csrf': '1', 'content-type': 'application/json' };
    async function json<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
      const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      assert.equal(response.status, 200, `${method} ${path}`); return response.json() as Promise<T>;
    }
    // Seed through the image's real storage implementation, with bounded inserts.
    // HTTP reads and reports below independently check the resulting history.
    const seed = `import { loadConfig } from './packages/api/src/config.ts'; import { initializeDatabase } from './packages/api/src/storage/migrations.ts'; const c=await initializeDatabase(loadConfig().config.storage); try { for(let offset=0;offset<30000;offset+=100) await c.db.insertInto('time_entries').values(Array.from({length:100},(_,i)=>({user_id:${me.id},workspace_id:${me.default_workspace_id},project_id:null,task_id:null,description:'image history '+(offset+i),start:'2026-10-05T10:00:00.000Z',stop:'2026-10-05T11:00:00.000Z',billable:0,duronly:0,all_day:0,deleted_at:null,created_with:'image-smoke',created_at:'2026-10-05T10:00:00.000Z',updated_at:'2026-10-05T11:00:00.000Z'}))).execute(); console.log(JSON.stringify({rows:Number((await c.db.selectFrom('time_entries').select(c.db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n),migrations:await c.db.selectFrom('storage_migrations').selectAll().execute()})); } finally { await c.close(); }`;
    const seeded = JSON.parse(await docker(['exec', app, 'node', '--input-type=module', '-e', seed]));
    assert.equal(seeded.rows, 30000); assert.equal(seeded.migrations.length, 3); event('seeded', seeded);
    const running = await json<{ id: number }>(`/api/v9/workspaces/${me.default_workspace_id}/time_entries`, 'POST', { description: 'persisted image timer', start: new Date().toISOString() });
    const range = { start_date: '2026-10-01', end_date: '2026-10-30' };
    const report = await fetch(base + '/api/app/report/detailed.csv', { method: 'POST', headers, body: JSON.stringify(range) });
    assert.equal(report.status, 200); const csv = await report.text();
    assert.equal(csv.trimEnd().split('\n').length, 30001); assert.ok(csv.includes('image history 29999')); event('report-verified', { rows: 30000, bytes: Buffer.byteLength(csv) });
    const stream = await fetch(base + '/api/app/timer/events', { headers }); assert.equal(stream.status, 200);
    const reader = stream.body!.getReader(); streams.push(reader); assert.equal((await reader.read()).done, false);
    const streamEnded = (async () => { for (;;) { if ((await reader.read()).done) return; } })(); requests.push(streamEnded);
    let pending = 0;
    const outcomes: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      pending++;
      requests.push(fetch(base + '/api/app/report/detailed.csv', { method: 'POST', headers, body: JSON.stringify(range), signal: AbortSignal.timeout(45000) })
        .then(async response => { await response.text(); outcomes.push({ status: response.status }); })
        .catch(() => { outcomes.push({ connectionClosed: true }); }).finally(() => { pending--; }));
    }
    assert.equal((await json<{ running_entry: { id: number } }>('/api/app/timer')).running_entry.id, running.id);
    const threads = await docker(['exec', app, 'node', '--input-type=module', '-e', `import {readdirSync,readFileSync} from 'node:fs'; console.log(JSON.stringify(readdirSync('/proc/1/task').map(tid=>({tid,stat:readFileSync('/proc/1/task/'+tid+'/stat','utf8')}))));`]);
    assert.ok(pending > 0, 'Heavy report requests must still be pending at SIGTERM');
    assert.ok((JSON.parse(threads) as { stat: string }[]).some(t => t.stat.includes('(WorkerThread)')), 'The report worker must exist during active shutdown');
    event('active-shutdown', { backend, pending, threads: JSON.parse(threads), activeSSE: true, timerResponded: true });
    await docker(['kill', '--signal', 'SIGTERM', app]);
    assert.equal(await docker(['wait', app]), '0');
    const stopped = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', app]));
    assert.equal(stopped.ExitCode, 0); assert.equal(stopped.OOMKilled, false); assert.equal(stopped.Pid, 0);
    await Promise.all(requests); event('shutdown-outcomes', { backend, outcomes, state: stopped });
    async function sessionsClosed(): Promise<void> {
      if (service) {
        const count = await query(backend === 'postgres' ? "SELECT count(*) FROM pg_stat_activity WHERE datname='tokkl_test' AND pid<>pg_backend_pid() AND backend_type='client backend'" : "SELECT count(*) FROM information_schema.processlist WHERE user='tokkl' AND db='tokkl_test'");
        assert.equal(count, '0', 'Application and report reader database sessions must close'); event('database-sessions-closed', { backend, count: 0 });
      }
    }
    await sessionsClosed();
    await docker(['start', app]); await healthy();
    assert.deepEqual(await json('/api/app/status'), { setup_required: false });
    assert.equal((await json<{ id: number }>('/api/v9/me')).id, me.id);
    assert.equal((await json<{ running_entry: { id: number } }>('/api/app/timer')).running_entry.id, running.id);
    assert.equal((await json<{ time_entries: unknown[] }>('/api/app/export.json')).time_entries.length, 30001);
    await docker(['kill', '--signal', 'SIGTERM', app]); assert.equal(await docker(['wait', app]), '0');
    await sessionsClosed();
    const logs = await docker(['logs', app]);
    assert.ok(!logs.includes(password) && !logs.includes(me.api_token), 'Database/account credentials leaked to container logs');
    assert.doesNotMatch(logs, /Unhandled|Shutdown failed|Startup failed/);
    event('application-logs', { backend, logs });
    event('persisted-restart-verified', { backend, rows: 30001 }); passed = true;
  } finally {
    for (const reader of streams) { try { await reader.cancel(); } catch { /* Closed during shutdown. */ } }
    if (app && !passed) {
      try { event('failure-application-logs', await docker(['logs', app])); } catch { /* Keep the original failure. */ }
    }
    for (const id of [app, service]) if (id) {
      try { await docker(['rm', '-f', '-v', id]); event('container-removed', { namespace, id }); }
      catch { cleanupErrors.push(`container ${id}`); }
    }
    await Promise.allSettled(requests);
    if (volume) { try { await docker(['volume', 'rm', volume]); } catch { cleanupErrors.push(`volume ${volume}`); } }
    if (network) { try { await docker(['network', 'rm', network]); } catch { cleanupErrors.push(`network ${network}`); } }
    event('namespace-removed', { namespace, volume, network, cleanupErrors, passed });
    assert.deepEqual(cleanupErrors, [], 'Owned resource cleanup failed');
  }
}
