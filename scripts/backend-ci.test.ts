import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
function job(name: string): string {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Required CI job ${name} is absent`);
  return match[1]!;
}

test('releases require all backend suites and both production image architectures', () => {
  const backends = job('backends');
  assert.match(backends, /suite: \[sqlite, postgres, mysql, mariadb, storage\]/);
  assert.match(backends, /fail-fast: false/);
  assert.match(backends, /run: npm run test:backends -- --suite \$\{\{ matrix.suite \}\}/);
  const containers = job('containers');
  assert.match(containers, /--platform linux\/amd64,linux\/arm64/);
  assert.match(containers, /npm run test:container -- --image tokkl:ci/);
  for (const name of ['release-version', 'release']) {
    const dependencies = job(name).match(/needs: \[([^\]]+)\]/)![1]!.split(',').map(s => s.trim());
    assert.ok(dependencies.includes('backends'), `${name} can bypass backend failures`);
    assert.ok(dependencies.includes('containers'), `${name} can bypass production image failures`);
  }
  for (const content of [backends, containers]) {
    assert.doesNotMatch(content, /continue-on-error:|if:/);
    assert.match(content, /timeout-minutes:/);
  }
});

test('backend entrypoint refuses unknown selections and operator databases before provisioning', () => {
  for (const [args, env, message] of [
    [['--suite', 'postgrez'], {}, /Expected --suite/],
    [['--suite', 'postgres', '--skip'], {}, /Expected --suite/],
    [[], { TOKKL_DATABASE_URL: 'postgres://operator:private@127.0.0.1/production' }, /Operator database targets are forbidden/],
  ] as const) {
    const result = spawnSync(process.execPath, ['packages/api/test/backends.ts', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /Backend suite:|Disposable/);
  }
});

test('production smoke refuses operator targets before creating a container', () => {
  const result = spawnSync(process.execPath, ['scripts/production-image-smoke.ts', '--image', 'never-start'], { env: { ...process.env, TOKKL_DATABASE_URL: 'postgres://operator:private@127.0.0.1/production' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Operator database targets are forbidden/);
  assert.doesNotMatch(result.stdout, /namespace-created|docker-command/);
});

test('root backend entrypoint forwards CI suite arguments to the API runner', () => {
  const result = spawnSync('npm', ['run', 'test:backends', '--', '--suite', 'invalid'], {
    env: { ...process.env, TOKKL_DATABASE_URL: 'postgres://operator:private@127.0.0.1/production' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /node test\/backends\.ts --suite invalid/);
  assert.match(result.stderr, /Operator database targets are forbidden/);
  assert.doesNotMatch(result.stdout, /Backend suite:|Disposable/);
});
