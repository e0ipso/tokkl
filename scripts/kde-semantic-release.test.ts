import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The release gate (desktop/kde/ci/semantic-release.js) and the dry run that picks the version the
// KDE packages are built for (desktop/kde/ci/next-release.js) run only on a real release. These
// tests run both against a throwaway repository that holds native-version.sh where the plugin looks
// for it, so nothing here touches the checkout or GitHub.

const HERE = dirname(fileURLToPath(import.meta.url));
const KDE = join(HERE, '..', 'desktop', 'kde');
const PLUGIN = join(KDE, 'ci', 'semantic-release.js');
const NEXT_RELEASE = join(KDE, 'ci', 'next-release.js');
const NATIVE_VERSION = join(KDE, 'scripts', 'native-version.sh');
const RELEASERC = join(HERE, '..', '.releaserc.json');

type Context = {
  cwd: string;
  env: Record<string, string | undefined>;
  nextRelease: { version: string };
  logger: { log: (...args: unknown[]) => void };
};
type Plugin = {
  verifyRelease: (config: object, context: Context) => Promise<void>;
  prepare: (config: object, context: Context) => Promise<void>;
};
const plugin: Plugin = await import(pathToFileURL(PLUGIN).href);

const GIT_IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

/** A throwaway git repository with native-version.sh committed, deleted when the test ends. */
function repository(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-kde-semantic-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo');
  mkdirSync(join(cwd, 'desktop', 'kde', 'scripts'), { recursive: true });
  writeFileSync(join(cwd, 'desktop', 'kde', 'scripts', 'native-version.sh'), readFileSync(NATIVE_VERSION));
  chmodSync(join(cwd, 'desktop', 'kde', 'scripts', 'native-version.sh'), 0o755);
  const git = (...args: string[]) => execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch', 'main');
  git('add', 'desktop');
  git('commit', '--quiet', '-m', 'chore: fixture');
  return { root, cwd, git };
}

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

/** A release gate fixture: dist/kde with two DEBs, an RPM and their manifests for `version`. */
function gate(t: { after: (fn: () => void) => void }, version = '1.2.3', native = version) {
  const repo = repository(t);
  const revision = repo.git('rev-parse', 'HEAD');
  const dist = join(repo.cwd, 'dist', 'kde');
  mkdirSync(dist, { recursive: true });
  const deb = `tokkl-kde_${native}_amd64.deb`;
  const ubuntu = `tokkl-kde_${native}_amd64-ubuntu26.04.deb`;
  const rpm = `tokkl-kde-${native}-1.fc44.x86_64.rpm`;
  const put = (name: string, content: string) => writeFileSync(join(dist, name), content);
  const manifest = (format: 'deb' | 'ubuntu-deb' | 'rpm', fields: Record<string, unknown> = {}) => {
    const name = format === 'deb' ? deb : format === 'ubuntu-deb' ? ubuntu : rpm;
    const want = { format, version, revision, package: name, sha256: sha256(readFileSync(join(dist, name), 'utf8')) };
    put(`kde-${format}.json`, JSON.stringify({ ...want, ...fields }));
  };
  put(deb, 'deb bytes');
  put(ubuntu, 'ubuntu bytes');
  put(rpm, 'rpm bytes');
  manifest('deb');
  manifest('ubuntu-deb');
  manifest('rpm');
  const logs: unknown[][] = [];
  const context = (env: Record<string, string> = {}): Context => ({
    cwd: repo.cwd,
    env: { PATH: process.env.PATH, ...env },
    nextRelease: { version },
    logger: { log: (...args) => logs.push(args) },
  });
  return { ...repo, revision, dist, deb, ubuntu, rpm, put, manifest, logs, context };
}

test('prepare accepts exactly both DEBs, the RPM and their manifests for the next version', async (t) => {
  const fixture = gate(t);
  await plugin.prepare({}, fixture.context());
  assert.deepEqual(fixture.logs, [['Releasing %s, %s and %s, built and checked from %s', fixture.deb, fixture.ubuntu, fixture.rpm, fixture.revision]]);
});

test('prepare names the packages by the native version of a prerelease', async (t) => {
  const fixture = gate(t, '1.3.0-rc.1', '1.3.0~rc1');
  await plugin.prepare({}, fixture.context());
  assert.equal(fixture.logs.length, 1);
});

test('prepare refuses when dist/kde is missing', async (t) => {
  const fixture = gate(t);
  rmSync(fixture.dist, { recursive: true });
  await assert.rejects(plugin.prepare({}, fixture.context()), /found: nothing$/);
});

for (const missing of ['deb', 'ubuntu', 'rpm', 'kde-deb.json', 'kde-ubuntu-deb.json', 'kde-rpm.json'] as const) {
  test(`prepare refuses when ${missing} is missing`, async (t) => {
    const fixture = gate(t);
    const name = missing === 'deb' ? fixture.deb : missing === 'ubuntu' ? fixture.ubuntu : missing === 'rpm' ? fixture.rpm : missing;
    rmSync(join(fixture.dist, name));
    await assert.rejects(plugin.prepare({}, fixture.context()), /^Error: Expected tokkl-kde_1\.2\.3_amd64\.deb, one tokkl-kde-1\.2\.3-1\.\*\.x86_64\.rpm/);
  });
}

for (const [what, extra] of [
  ['a second RPM', 'tokkl-kde-1.2.3-1.fc43.x86_64.rpm'],
  ['a DEB of another version', 'tokkl-kde_1.2.2_amd64.deb'],
  ['an RPM of another version', 'tokkl-kde-1.2.2-1.fc44.x86_64.rpm'],
  ['an unrelated file', 'notes.txt'],
] as const) {
  test(`prepare refuses ${what} in dist/kde`, async (t) => {
    const fixture = gate(t);
    fixture.put(extra, 'bytes');
    await assert.rejects(plugin.prepare({}, fixture.context()), new RegExp(`found: .*${extra.replace(/\./g, '\\.')}`));
  });
}

test('prepare refuses packages built for another version', async (t) => {
  const fixture = gate(t);
  await assert.rejects(plugin.prepare({}, { ...fixture.context(), nextRelease: { version: '1.2.4' } }), /^Error: Expected tokkl-kde_1\.2\.4_amd64\.deb/);
});

for (const format of ['deb', 'ubuntu-deb', 'rpm'] as const) {
  for (const [key, value] of [
    ['format', format === 'deb' ? 'rpm' : 'deb'],
    ['version', '1.2.2'],
    ['revision', '0'.repeat(40)],
    ['package', 'tokkl-kde_1.2.2_amd64.deb'],
    ['sha256', sha256('other bytes')],
  ] as const) {
    test(`prepare refuses kde-${format}.json with another ${key}`, async (t) => {
      const fixture = gate(t);
      fixture.manifest(format, { [key]: value });
      await assert.rejects(plugin.prepare({}, fixture.context()), new RegExp(`dist/kde/kde-${format}\\.json has ${key} "${value}", expected `));
    });
  }

  test(`prepare refuses kde-${format}.json without a field`, async (t) => {
    const fixture = gate(t);
    fixture.manifest(format, { revision: undefined });
    await assert.rejects(plugin.prepare({}, fixture.context()), new RegExp(`kde-${format}\\.json has revision undefined, expected "`));
  });

  test(`prepare refuses a ${format} changed after its manifest was written`, async (t) => {
    const fixture = gate(t);
    fixture.put(format === 'deb' ? fixture.deb : format === 'ubuntu-deb' ? fixture.ubuntu : fixture.rpm, 'tampered bytes');
    await assert.rejects(plugin.prepare({}, fixture.context()), new RegExp(`kde-${format}\\.json has sha256 `));
  });

  test(`prepare refuses kde-${format}.json that is not JSON`, async (t) => {
    const fixture = gate(t);
    fixture.put(`kde-${format}.json`, '{"format":');
    await assert.rejects(plugin.prepare({}, fixture.context()), new RegExp(`dist/kde/kde-${format}\\.json is not valid JSON`));
  });
}

test('prepare refuses packages recorded for an earlier commit', async (t) => {
  const fixture = gate(t);
  fixture.git('commit', '--quiet', '--allow-empty', '-m', 'fix: later');
  await assert.rejects(plugin.prepare({}, fixture.context()), /kde-deb\.json has revision "[0-9a-f]{40}", expected "[0-9a-f]{40}"/);
});

test('verifyRelease accepts the version the packages were built for', async (t) => {
  const fixture = gate(t);
  await plugin.verifyRelease({}, fixture.context({ TOKKL_KDE_RELEASE_VERSION: '1.2.3' }));
  assert.deepEqual(fixture.logs, [['KDE packages for %s will have version %s', '1.2.3', '1.2.3']]);
});

test('verifyRelease accepts any packageable version when no build version is given', async (t) => {
  const fixture = gate(t);
  await plugin.verifyRelease({}, fixture.context());
  assert.equal(fixture.logs.length, 1);
});

test('verifyRelease refuses a next version other than the one the packages were built for', async (t) => {
  const fixture = gate(t);
  await assert.rejects(
    plugin.verifyRelease({}, fixture.context({ TOKKL_KDE_RELEASE_VERSION: '1.2.2' })),
    /^Error: The KDE packages were built for 1\.2\.2, but the next release is 1\.2\.3$/,
  );
});

test('verifyRelease refuses a version the packages cannot carry', async (t) => {
  const fixture = gate(t);
  await assert.rejects(
    plugin.verifyRelease({}, { ...fixture.context(), nextRelease: { version: '1.2.3-rc-1' } }),
    /native-version\.sh 1\.2\.3-rc-1 exited with 2/,
  );
});

/**
 * A repository for next-release.js with the release rules of .releaserc.json, the KDE plugin and
 * a local bare remote, so the dry run can check that it could push without reaching GitHub.
 */
function releaseRepository(t: { after: (fn: () => void) => void }) {
  const repo = repository(t);
  const remote = join(repo.root, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch', 'main', remote]);
  const config = JSON.parse(readFileSync(RELEASERC, 'utf8'));
  const keep = ['@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator'];
  const plugins = config.plugins.filter((entry: string | [string]) => keep.includes(Array.isArray(entry) ? entry[0] : entry));
  assert.equal(plugins.length, keep.length, '.releaserc.json lost a plugin these tests rely on');
  writeFileSync(join(repo.cwd, '.releaserc.json'), JSON.stringify({ ...config, plugins: [...plugins, PLUGIN], repositoryUrl: pathToFileURL(remote).href }));
  repo.git('add', '.releaserc.json');
  repo.git('commit', '--quiet', '-m', 'chore: release configuration');
  repo.git('remote', 'add', 'origin', pathToFileURL(remote).href);
  const commit = (message: string) => repo.git('commit', '--quiet', '--allow-empty', '-m', message);
  const tag = (name: string) => repo.git('tag', name);
  // Only these variables, so a CI run of this test does not look like a release run to env-ci.
  const nextRelease = (env: Record<string, string> = {}) => {
    repo.git('push', '--quiet', '--tags', 'origin', 'main');
    return spawnSync(process.execPath, [NEXT_RELEASE], {
      cwd: repo.cwd,
      env: { PATH: process.env.PATH, HOME: repo.root, GIT_CONFIG_NOSYSTEM: '1', ...env },
      encoding: 'utf8',
    });
  };
  return { commit, tag, nextRelease };
}

test('next-release prints only the first version when nothing was released yet', (t) => {
  const repo = releaseRepository(t);
  repo.commit('feat: first feature');
  const result = repo.nextRelease();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.0.0\n');
  assert.match(result.stderr, /There is no previous release/);
});

test('next-release bumps the last release by the release rules', (t) => {
  for (const [message, next] of [
    ['fix: a bug', '1.2.4'],
    ['refactor: tidy up', '1.2.4'],
    ['feat: a feature', '1.3.0'],
  ] as const) {
    const repo = releaseRepository(t);
    repo.commit('feat: earlier');
    repo.tag('v1.2.3');
    repo.commit(message);
    const result = repo.nextRelease();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${next}\n`, message);
  }
});

test('next-release prints nothing when the commits warrant no release', (t) => {
  const repo = releaseRepository(t);
  repo.commit('feat: earlier');
  repo.tag('v1.2.3');
  repo.commit('docs: explain');
  repo.commit('chore: tidy');
  const result = repo.nextRelease();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('next-release fails, printing nothing, when the KDE plugin refuses the version', (t) => {
  const repo = releaseRepository(t);
  repo.commit('feat: earlier');
  repo.tag('v1.2.3');
  repo.commit('fix: a bug');
  const result = repo.nextRelease({ TOKKL_KDE_RELEASE_VERSION: '1.3.0' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /The KDE packages were built for 1\.3\.0, but the next release is 1\.2\.4/);
});
