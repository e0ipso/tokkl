import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The release-only steps of .github/workflows/ci.yml run only after a real release, so nothing else
// exercises them before release day. Each test takes a step's `run:` script from the workflow as it
// is, and runs it the way GitHub runs a bash step (bash -eo pipefail) in a throwaway directory, with
// a stand-in `gh` that records its arguments instead of uploading.

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = readFileSync(join(HERE, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const NATIVE_VERSION = join(HERE, '..', 'desktop', 'kde', 'scripts', 'native-version.sh');
const REPOSITORY = 'example/tokkl';

/** The block-scalar `run: |` script of the step named `step` in job `job`, dedented. */
function runScript(job: string, step: string): string {
  const lines = WORKFLOW.split('\n');
  const jobStart = lines.indexOf(`  ${job}:`);
  assert.notEqual(jobStart, -1, `job ${job} not found in ci.yml`);
  let jobEnd = lines.findIndex((line, i) => i > jobStart && /^ {2}\S/.test(line));
  if (jobEnd === -1) jobEnd = lines.length;
  const stepStart = lines.findIndex((line, i) => i > jobStart && i < jobEnd && line.trim() === `- name: ${step}`);
  assert.notEqual(stepStart, -1, `step "${step}" not found in job ${job}`);
  const runLine = lines.findIndex((line, i) => i > stepStart && i < jobEnd && /^\s+run: \|$/.test(line));
  assert.notEqual(runLine, -1, `step "${step}" in job ${job} has no run: | script`);
  const keyIndent = lines[runLine]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(runLine + 1, jobEnd)) {
    if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join('\n').trimEnd() + '\n';
}

type Sandbox = { root: string; dir: string; ghLog: string; put: (name: string, content?: string) => void };

/** A throwaway directory with an asset directory and a `gh` stand-in, deleted when the test ends. */
function sandbox(t: { after: (fn: () => void) => void }): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-release-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'assets');
  mkdirSync(dir);
  mkdirSync(join(root, 'bin'));
  const ghLog = join(root, 'gh.log');
  writeFileSync(join(root, 'bin', 'gh'), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$GH_LOG"\n');
  chmodSync(join(root, 'bin', 'gh'), 0o755);
  const put = (name: string, content = 'x') => writeFileSync(join(dir, name), content);
  return { root, dir, ghLog, put };
}

function runStep(box: Sandbox, script: string, env: Record<string, string>) {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: box.root,
    env: {
      PATH: `${join(box.root, 'bin')}:${process.env.PATH}`,
      GH_LOG: box.ghLog,
      GH_TOKEN: 'not-a-token',
      GITHUB_REPOSITORY: REPOSITORY,
      DIR: box.dir,
      ...env,
    },
    encoding: 'utf8',
  });
  const gh = existsSync(box.ghLog) ? readFileSync(box.ghLog, 'utf8').trimEnd().split('\n') : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, gh };
}

const GNOME_PUBLISH = runScript('gnome-publish', 'Attach the GNOME files to the release');
const MACOS_PUBLISH = runScript('macos-publish', 'Attach the DMG to the release');

const DEB = 'tokkl-timerd_1.2.3_amd64.deb';
const RPM = 'tokkl-timerd-1.2.3-1.fc44.x86_64.rpm';
const ZIP = 'tokkl-gnome-extension-1.2.3.zip';

test('gnome-publish attaches the DEB, the RPM and the zip with their labels', (t) => {
  const box = sandbox(t);
  [DEB, RPM, ZIP].forEach((name) => box.put(name));
  const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.2.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.gh, [
    'release',
    'upload',
    'v1.2.3',
    `${box.dir}/${DEB}#tokkl-timerd DEB for Debian 13 (amd64)`,
    `${box.dir}/${RPM}#tokkl-timerd RPM for Fedora 44 (x86_64)`,
    `${box.dir}/${ZIP}#Tokkl GNOME Shell extension (GNOME Shell 46 to 51)`,
    '--repo',
    REPOSITORY,
    '--clobber',
  ]);
});

test('gnome-publish matches the native version of a prerelease, not the tag', (t) => {
  // The packages carry native-version.sh's form of the version; the zip keeps the tag's.
  const box = sandbox(t);
  const native = execFileSync(NATIVE_VERSION, ['1.3.0-rc.1'], { encoding: 'utf8' }).trim();
  assert.notEqual(native, '1.3.0-rc.1');
  const deb = `tokkl-timerd_${native}_amd64.deb`;
  const rpm = `tokkl-timerd-${native}-1.fc44.x86_64.rpm`;
  [deb, rpm, 'tokkl-gnome-extension-1.3.0-rc.1.zip'].forEach((name) => box.put(name));
  const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.3.0-rc.1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.gh?.[3], `${box.dir}/${deb}#tokkl-timerd DEB for Debian 13 (amd64)`);
  assert.equal(result.gh?.[4], `${box.dir}/${rpm}#tokkl-timerd RPM for Fedora 44 (x86_64)`);
});

for (const [missing, present] of [
  ['the DEB', [RPM, ZIP]],
  ['the RPM', [DEB, ZIP]],
  ['the zip', [DEB, RPM]],
  ['everything', []],
] as const) {
  test(`gnome-publish uploads nothing when ${missing} is missing`, (t) => {
    const box = sandbox(t);
    present.forEach((name) => box.put(name));
    const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.2.3' });
    assert.equal(result.status, 1);
    assert.equal(result.gh, null);
    assert.match(result.stdout, /::error::expected one DEB, one RPM and .*tokkl-gnome-extension-1\.2\.3\.zip/);
  });
}

test('gnome-publish uploads nothing when two DEBs or two RPMs are in the artifact', (t) => {
  for (const extra of ['tokkl-timerd_1.2.2_amd64.deb', 'tokkl-timerd-1.2.2-1.fc44.x86_64.rpm']) {
    const box = sandbox(t);
    [DEB, RPM, ZIP, extra].forEach((name) => box.put(name));
    const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.2.3' });
    assert.equal(result.status, 1, extra);
    assert.equal(result.gh, null, extra);
  }
});

test('gnome-publish refuses a zip built for another version', (t) => {
  const box = sandbox(t);
  [DEB, RPM, 'tokkl-gnome-extension-1.2.2.zip'].forEach((name) => box.put(name));
  const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.2.3' });
  assert.equal(result.status, 1);
  assert.equal(result.gh, null);
});

test('gnome-publish fails when the upload fails', (t) => {
  const box = sandbox(t);
  [DEB, RPM, ZIP].forEach((name) => box.put(name));
  writeFileSync(join(box.root, 'bin', 'gh'), '#!/usr/bin/env bash\necho "HTTP 404" >&2\nexit 1\n');
  const result = runStep(box, GNOME_PUBLISH, { TAG: 'v1.2.3' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTP 404/);
});

test('macos-publish attaches the DMG for the tag with its label', (t) => {
  const box = sandbox(t);
  box.put('Tokkl-1.2.3-arm64.dmg');
  const result = runStep(box, MACOS_PUBLISH, { TAG: 'v1.2.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.gh, [
    'release',
    'upload',
    'v1.2.3',
    `${box.dir}/Tokkl-1.2.3-arm64.dmg#Tokkl for macOS 13 or later (Apple silicon)`,
    '--repo',
    REPOSITORY,
    '--clobber',
  ]);
});

test('macos-publish uploads nothing when the DMG for the tag is missing', (t) => {
  const box = sandbox(t);
  box.put('Tokkl-1.2.2-arm64.dmg');
  const result = runStep(box, MACOS_PUBLISH, { TAG: 'v1.2.3' });
  assert.notEqual(result.status, 0);
  assert.equal(result.gh, null);
});

for (const job of ['gnome-release', 'macos-release']) {
  const script = runScript(job, 'Check the version');

  test(`${job} takes VERSION from a tag that matches package.json`, (t) => {
    const box = sandbox(t);
    writeFileSync(join(box.root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    const githubEnv = join(box.root, 'github.env');
    writeFileSync(githubEnv, '');
    const result = runStep(box, script, { TAG: 'v1.2.3', GITHUB_ENV: githubEnv });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(githubEnv, 'utf8'), 'VERSION=1.2.3\n');
  });

  test(`${job} stops when package.json at the tag holds another version`, (t) => {
    const box = sandbox(t);
    writeFileSync(join(box.root, 'package.json'), JSON.stringify({ version: '1.2.2' }));
    const githubEnv = join(box.root, 'github.env');
    writeFileSync(githubEnv, '');
    const result = runStep(box, script, { TAG: 'v1.2.3', GITHUB_ENV: githubEnv });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::package\.json at v1\.2\.3 does not have version 1\.2\.3/);
    assert.equal(readFileSync(githubEnv, 'utf8'), '');
  });
}

// kde-release's "Record the package" step runs in a checkout: it compares HEAD with REVISION and
// maps the version with desktop/kde/scripts/native-version.sh, so the sandbox gets a one-commit
// repository holding that script.
const RECORD = runScript('kde-release', 'Record the package');

function recordSandbox(t: { after: (fn: () => void) => void }) {
  const box = sandbox(t);
  const scripts = join(box.root, 'desktop', 'kde', 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'native-version.sh'), readFileSync(NATIVE_VERSION));
  chmodSync(join(scripts, 'native-version.sh'), 0o755);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: box.root,
      encoding: 'utf8',
    }).trim();
  git('init', '--quiet');
  git('add', 'desktop');
  git('commit', '--quiet', '-m', 'test: fixture');
  const revision = git('rev-parse', 'HEAD');
  const output = join(box.root, 'kde');
  mkdirSync(output);
  const release = join(box.root, 'kde-release');
  const run = (env: Record<string, string>) => runStep(box, RECORD, { OUTPUT: output, DIR: release, REVISION: revision, ...env });
  return { box, revision, output, release, run };
}

const sha256Of = (content: string) => createHash('sha256').update(content).digest('hex');

for (const format of ['deb', 'ubuntu-deb'] as const) {
  test(`kde-release records ${format} separately with a manifest`, (t) => {
    const { revision, output, release, run } = recordSandbox(t);
    const name = `tokkl-kde_1.2.3_amd64${format === 'ubuntu-deb' ? '-ubuntu26.04' : ''}.deb`;
    writeFileSync(join(output, name), 'deb bytes');
    writeFileSync(join(output, 'tokkl-kde_1.2.2_amd64.deb'), 'older deb');
    writeFileSync(join(output, `tokkl-kde_1.2.3_amd64${format === 'deb' ? '-ubuntu26.04' : ''}.deb`), 'other target');
    const result = run({ FORMAT: format, VERSION: '1.2.3' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(release).sort(), [`kde-${format}.json`, name]);
    assert.equal(readFileSync(join(release, name), 'utf8'), 'deb bytes');
    assert.deepEqual(JSON.parse(readFileSync(join(release, `kde-${format}.json`), 'utf8')), {
      format,
      version: '1.2.3',
      revision,
      package: name,
      sha256: sha256Of('deb bytes'),
    });
  });
}

test('kde-release records the RPM of a prerelease under its native version', (t) => {
  const { revision, output, release, run } = recordSandbox(t);
  const name = 'tokkl-kde-1.3.0~rc1-1.fc44.x86_64.rpm';
  writeFileSync(join(output, name), 'rpm bytes');
  const result = run({ FORMAT: 'rpm', VERSION: '1.3.0-rc.1' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(release).sort(), ['kde-rpm.json', name]);
  assert.deepEqual(JSON.parse(readFileSync(join(release, 'kde-rpm.json'), 'utf8')), {
    format: 'rpm',
    version: '1.3.0-rc.1',
    revision,
    package: name,
    sha256: sha256Of('rpm bytes'),
  });
});

test('kde-release records nothing when the checkout is not the revision being released', (t) => {
  const { output, release, run } = recordSandbox(t);
  writeFileSync(join(output, 'tokkl-kde_1.2.3_amd64.deb'), 'deb bytes');
  const result = run({ FORMAT: 'deb', VERSION: '1.2.3', REVISION: '0'.repeat(40) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::checked out [0-9a-f]{40}, expected 0{40}/);
  assert.equal(existsSync(release), false);
});

for (const [format, files] of [
  ['deb', ['tokkl-kde_1.2.2_amd64.deb']],
  ['ubuntu-deb', ['tokkl-kde_1.2.3_amd64.deb']],
  ['rpm', ['tokkl-kde-1.2.2-1.fc44.x86_64.rpm']],
  ['rpm', ['tokkl-kde-1.2.3-1.fc43.x86_64.rpm', 'tokkl-kde-1.2.3-1.fc44.x86_64.rpm']],
] as const) {
  test(`kde-release records nothing for ${format} when the output holds only ${files.join(' and ')}`, (t) => {
    const { output, release, run } = recordSandbox(t);
    files.forEach((name) => writeFileSync(join(output, name), 'bytes'));
    const result = run({ FORMAT: format, VERSION: '1.2.3' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`::error::expected one tokkl-kde ${format} for 1\\.2\\.3 in `));
    assert.equal(existsSync(release), false);
  });
}
