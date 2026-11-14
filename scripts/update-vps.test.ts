import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPDATER = readFileSync(join(ROOT, 'scripts/update-vps.sh'), 'utf8');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t: { after: (fn: () => void) => void }, version = '2.4.0') {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-vps-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'app with spaces');
  const releases = join(app, 'releases');
  const previous = join(releases, 'previous');
  const older = join(releases, 'older');
  const bin = join(root, 'bin');
  const source = join(root, 'archive/source');
  for (const directory of [previous, older, bin, source, join(root, 'data'), join(root, 'config')]) {
    mkdirSync(directory, { recursive: true });
  }
  symlinkSync(previous, join(app, 'current'));
  writeFileSync(join(root, 'data/tokkl.sqlite'), 'production data');
  writeFileSync(join(root, 'config/tokkl.env'), 'private configuration');
  writeFileSync(join(root, 'service'), 'active');
  writeFileSync(join(root, 'events'), '');
  writeFileSync(join(source, 'package.json'), JSON.stringify({ version, type: 'module' }));
  writeFileSync(join(source, 'package-lock.json'), '{}');
  writeFileSync(join(source, 'LICENSE'), 'fixture license');
  for (const name of ['api', 'common', 'types']) {
    const directory = join(source, 'packages', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: `@tokkl/${name}`, type: 'module', exports: { './time': './time.ts' } }),
    );
    writeFileSync(join(directory, 'tsconfig.json'), '{}');
    writeFileSync(join(directory, 'unused.test.ts'), '');
  }
  mkdirSync(join(source, 'packages/api/src'));
  writeFileSync(join(source, 'packages/api/src/index.ts'), '');
  writeFileSync(join(source, 'packages/common/time.ts'), 'export const ready: boolean = true;');
  const archive = join(root, 'source.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', dirname(source), 'source']);

  function command(name: string, body: string) {
    writeFileSync(join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  }
  const log = String.raw`const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE + '/events', path.basename(process.argv[1]) + ' ' + args.join(' ') + '\n');`;
  command('id', "console.log('0');");
  command('chown', '');
  command(
    'runuser',
    `${log}
const child = require('node:child_process').spawnSync(args[3], args.slice(4), {stdio:'inherit'});
process.exit(child.status ?? 1);`,
  );
  command(
    'curl',
    `${log}
const url = args.find(value => /^https?:/.test(value));
const output = args[args.indexOf('-o') + 1];
if (url.endsWith('/releases/latest')) {
  fs.writeFileSync(output, JSON.stringify({tag_name: process.env.TAG}));
} else if (url.includes('/archive/refs/tags/' + process.env.TAG + '.tar.gz')) {
  fs.copyFileSync(process.env.ARCHIVE, output);
} else if (url.endsWith('/healthz')) {
  if (process.env.FAIL_HEALTH) process.exit(22);
  fs.writeFileSync(output, JSON.stringify({ok: !process.env.BAD_HEALTH}));
} else {
  process.exit(22);
}`,
  );
  command(
    'npm',
    `${log}
if (args[0] === 'run' && args[1] === 'build') {
  if (process.env.FAIL_BUILD) process.exit(23);
  fs.mkdirSync('dist/web', {recursive:true});
  fs.writeFileSync('dist/web/index.html', '<html>built</html>');
}
if (args[0] === 'ci') {
  fs.mkdirSync('node_modules/@tokkl', {recursive:true});
  for (const name of ['common','types']) fs.symlinkSync('../../packages/' + name, 'node_modules/@tokkl/' + name);
}
if (args[0] === 'audit' && process.env.FAIL_AUDIT) process.exit(1);`,
  );
  command(
    'systemctl',
    `${log}
const state = process.env.FIXTURE + '/service';
if (args[0] === 'stop') fs.writeFileSync(state, 'stopped');
if (args[0] === 'start') fs.writeFileSync(state, 'active');
if (args[0] === 'is-active' && fs.readFileSync(state,'utf8') !== 'active') process.exit(3);`,
  );
  const updater = join(root, 'update.sh');
  writeFileSync(
    updater,
    UPDATER.replace('app=/opt/tokkl', `app=${quote(app)}`).replace(
      'mktemp -d /var/tmp/tokkl-update.XXXXXX',
      `mktemp -d ${quote(join(root, 'work.XXXXXX'))}`,
    ),
    { mode: 0o755 },
  );
  function run(args: string[] = [], overrides: Record<string, string> = {}) {
    return spawnSync('bash', [updater, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SUDO_USER: 'builder',
        FIXTURE: root,
        ARCHIVE: archive,
        TAG: `v${version}`,
        ...overrides,
      },
    });
  }
  function preserved() {
    assert.equal(readFileSync(join(root, 'data/tokkl.sqlite'), 'utf8'), 'production data');
    assert.equal(readFileSync(join(root, 'config/tokkl.env'), 'utf8'), 'private configuration');
    assert.ok(!readdirSync(root).some(name => name.startsWith('work.')), 'Temporary build was not removed');
  }
  const events = () => readFileSync(join(root, 'events'), 'utf8');
  return { root, app, releases, previous, older, run, preserved, events };
}

describe('native VPS updater', { skip: process.platform !== 'linux' }, () => {
  for (const args of [[], ['latest'], ['2.4.0'], ['v2.4.0']]) {
    test(`installs ${args.join(' ') || 'the default latest release'} and cleans up`, t => {
      const box = fixture(t);
      const result = box.run(args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const current = realpathSync(join(box.app, 'current'));
      assert.notEqual(current, box.previous);
      assert.equal(readFileSync(join(current, 'dist/web/index.html'), 'utf8'), '<html>built</html>');
      assert.ok(lstatSync(join(current, 'node_modules/@tokkl/common')).isSymbolicLink());
      assert.equal(realpathSync(join(current, 'node_modules/@tokkl/common')), join(current, 'packages/common'));
      assert.ok(!existsSync(join(current, 'packages/common/unused.test.ts')));
      assert.ok(!existsSync(join(current, 'packages/common/tsconfig.json')));
      assert.match(readFileSync(join(current, 'RELEASE'), 'utf8'), /version=2\.4\.0\ntag=v2\.4\.0/);
      assert.ok(existsSync(box.previous));
      assert.ok(!existsSync(box.older));
      assert.equal(readdirSync(box.releases).length, 2);
      const events = box.events();
      assert.equal(events.includes('/releases/latest'), args.length === 0 || args[0] === 'latest');
      assert.ok(events.indexOf('npm run build') < events.indexOf('systemctl stop'));
      assert.ok(events.includes('npm update body-parser qs'));
      assert.match(events, /npm audit .*--audit-level=moderate$/m);
      box.preserved();
    });
  }

  for (const failure of ['FAIL_BUILD', 'FAIL_AUDIT']) {
    test(`${failure} leaves the current release and service alone`, t => {
      const box = fixture(t);
      const result = box.run([], { [failure]: '1' });
      assert.notEqual(result.status, 0);
      assert.ok(box.events().includes(failure === 'FAIL_BUILD' ? 'npm run build' : 'npm audit'));
      assert.equal(realpathSync(join(box.app, 'current')), box.previous);
      assert.equal(readFileSync(join(box.root, 'service'), 'utf8'), 'active');
      assert.ok(!box.events().includes('systemctl stop'));
      assert.equal(readdirSync(box.releases).length, 2);
      box.preserved();
    });
  }

  test('an unavailable explicit version fails without selecting latest', t => {
    const box = fixture(t);
    const result = box.run(['9.9.9']);
    assert.notEqual(result.status, 0);
    assert.ok(box.events().includes('/archive/refs/tags/v9.9.9.tar.gz'));
    assert.ok(!box.events().includes('/releases/latest'));
    assert.ok(!box.events().includes('systemctl stop'));
    assert.equal(realpathSync(join(box.app, 'current')), box.previous);
    box.preserved();
  });

  for (const failure of ['FAIL_HEALTH', 'BAD_HEALTH']) {
    test(`${failure} reports failure and leaves the new release selected`, t => {
      const box = fixture(t);
      const result = box.run([], { [failure]: '1' });
      assert.notEqual(result.status, 0);
      const current = realpathSync(join(box.app, 'current'));
      assert.notEqual(current, box.previous);
      assert.ok(existsSync(current));
      assert.ok(existsSync(box.previous));
      assert.ok(existsSync(box.older));
      box.preserved();
    });
  }

  test('rejects concurrent updates before downloading or stopping the service', t => {
    const box = fixture(t);
    const fd = openSync(join(box.app, '.update.lock'), 'w');
    t.after(() => closeSync(fd));
    assert.equal(spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] }).status, 0);
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Another Tokkl update is running/);
    assert.equal(box.events(), '');
    box.preserved();
  });

  test('rejects a nested current release before cleanup can remove its parent', t => {
    const box = fixture(t);
    const nested = join(box.previous, 'nested');
    mkdirSync(nested);
    rmSync(join(box.app, 'current'));
    symlinkSync(nested, join(box.app, 'current'));
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected current release/);
    assert.equal(realpathSync(join(box.app, 'current')), nested);
    assert.ok(existsSync(box.older));
    assert.equal(box.events(), '');
    box.preserved();
  });

  test('rejects invalid versions and extra arguments before doing work', t => {
    const box = fixture(t);
    for (const args of [['../../bad'], ['2.4.0', 'extra']]) {
      const result = box.run(args);
      assert.notEqual(result.status, 0);
    }
    assert.equal(box.events(), '');
    box.preserved();
  });
});
