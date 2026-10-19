import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// desktop/kde/ci/previous-package.sh runs only in the release, against the published releases.
// These tests run it with a stand-in `gh` that serves releases from a throwaway directory: `release
// list` prints the tags, `release view <tag>` the release's assets, `release download` copies the
// asset's bytes, and marker files make a call fail.

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'desktop', 'kde', 'ci', 'previous-package.sh');
const RELEASERC = JSON.parse(readFileSync(join(HERE, '..', '.releaserc.json'), 'utf8'));
const GITHUB_ASSETS: { path: string; label: string }[] = RELEASERC.plugins.find(
  (entry: unknown) => Array.isArray(entry) && entry[0] === '@semantic-release/github',
)[1].assets;
const LABEL = {
  deb: GITHUB_ASSETS.find((asset) => asset.path.endsWith('.deb'))!.label,
  rpm: GITHUB_ASSETS.find((asset) => asset.path.endsWith('.rpm'))!.label,
};

const GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FIXTURE/gh.log"
case "$1 $2" in
    "release list")
        [ ! -e "$FIXTURE/fail-list" ] || { echo "HTTP 403: Resource not accessible" >&2; exit 1; }
        cat "$FIXTURE/tags" ;;
    "release view")
        [ -f "$FIXTURE/releases/$3.json" ] || { echo "release not found" >&2; exit 1; }
        cat "$FIXTURE/releases/$3.json" ;;
    "release download")
        tag="$3"; shift 3
        while [ $# -gt 0 ]; do
            case "$1" in --pattern) pattern="$2" ;; --dir) dir="$2" ;; esac
            shift 2
        done
        if [ -e "$FIXTURE/fail-download" ]; then
            [ ! -e "$FIXTURE/partial" ] || head -c 3 "$FIXTURE/files/$tag/$pattern" > "$dir/$pattern"
            echo "connection reset" >&2
            exit 1
        fi
        cp "$FIXTURE/files/$tag/$pattern" "$dir/" ;;
    *) echo "unexpected gh $*" >&2; exit 64 ;;
esac
`;

type Asset = { name: string; label?: string; state?: string; digest?: string | null; size?: number; content?: string };
type Release = { tag: string; assets: Asset[] };

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
const deb = (native: string, extra: Partial<Asset> = {}): Asset => ({ name: `tokkl-kde_${native}_amd64.deb`, label: LABEL.deb, ...extra });
const rpm = (native: string, dist = 'fc44', extra: Partial<Asset> = {}): Asset => ({
  name: `tokkl-kde-${native}-1.${dist}.x86_64.rpm`,
  label: LABEL.rpm,
  ...extra,
});

/** A throwaway directory with the stand-in `gh` and the given releases, deleted when the test ends. */
function fixture(t: { after: (fn: () => void) => void }, releases: Release[], tags = releases.map((r) => r.tag)) {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-previous-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const data = join(root, 'gh');
  const output = join(root, 'previous');
  mkdirSync(bin);
  mkdirSync(join(data, 'releases'), { recursive: true });
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(data, 'tags'), tags.map((tag) => `${tag}\n`).join(''));
  for (const release of releases) {
    mkdirSync(join(data, 'files', release.tag), { recursive: true });
    const assets = release.assets.map((asset) => {
      const content = asset.content ?? `${release.tag} ${asset.name}`;
      writeFileSync(join(data, 'files', release.tag, asset.name), content);
      return {
        name: asset.name,
        label: asset.label ?? '',
        state: asset.state ?? 'uploaded',
        digest: asset.digest === undefined ? `sha256:${sha256(content)}` : asset.digest,
        size: asset.size ?? Buffer.byteLength(content),
      };
    });
    writeFileSync(join(data, 'releases', `${release.tag}.json`), JSON.stringify({ assets }));
  }
  const mark = (name: 'fail-list' | 'fail-download' | 'partial') => writeFileSync(join(data, name), '');
  const forget = (tag: string) => rmSync(join(data, 'releases', `${tag}.json`));
  const run = (format: 'deb' | 'rpm', version: string, path = `${bin}:${process.env.PATH}`) => {
    const result = spawnSync(SCRIPT, ['--format', format, '--version', version, '--output', output], {
      env: { PATH: path, FIXTURE: data, HOME: root },
      encoding: 'utf8',
    });
    const log = join(data, 'gh.log');
    const gh = existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [];
    const left = existsSync(output) ? readdirSync(output) : [];
    return { ...result, gh, left, output, data };
  };
  return { root, bin, mark, forget, run };
}

const FALLBACK = /the upgrade check uses a build of this source as 0\.0\.0 instead\n$/;

function assertFallback(result: ReturnType<ReturnType<typeof fixture>['run']>, reason: RegExp) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, reason);
  assert.match(result.stderr, FALLBACK);
  assert.deepEqual(result.left, []);
}

test('picks the newest strictly older release with one asset of the format by package version order', (t) => {
  const box = fixture(t, [
    { tag: 'v1.2.9', assets: [deb('1.2.9')] },
    { tag: 'v1.4.0', assets: [deb('1.4.0')] },
    { tag: 'v1.3.0', assets: [deb('1.3.0')] },
    { tag: 'v1.3.0-rc.1', assets: [deb('1.3.0~rc1', { label: 'tokkl-kde DEB for Debian 12 (amd64)' })] },
    { tag: 'v1.2.11', assets: [deb('1.2.11', { digest: null })] },
    { tag: 'v1.2.10', assets: [deb('1.2.10'), rpm('1.2.10')] },
  ], ['v1.2.9', 'v1.4.0', 'nightly', 'v1.3.0', 'v1.3.0-rc.1', 'v1.2.11', 'v1.2.10', 'v1.2.3-rc-1']);
  const result = box.run('deb', '1.3.0');
  assert.equal(result.status, 0, result.stderr);
  const file = join(result.output, 'tokkl-kde_1.2.10_amd64.deb');
  assert.equal(result.stdout, `${file}\n`);
  assert.equal(readFileSync(file, 'utf8'), 'v1.2.10 tokkl-kde_1.2.10_amd64.deb');
  assert.deepEqual(result.left, ['tokkl-kde_1.2.10_amd64.deb']);
  assert.deepEqual(result.gh.slice(0, 4), [
    'release list --exclude-drafts --exclude-pre-releases --limit 1000 --json tagName --jq .[].tagName',
    'release view v1.3.0-rc.1 --json assets',
    'release view v1.2.11 --json assets',
    'release view v1.2.10 --json assets',
  ]);
  assert.equal(result.gh.length, 5);
  assert.ok(
    result.gh[4]!.startsWith(`release download v1.2.10 --pattern tokkl-kde_1.2.10_amd64.deb --dir ${result.output}/.download.`),
    result.gh[4],
  );
  assert.match(result.stderr, /v1\.3\.0-rc\.1 has no single "tokkl-kde DEB for Debian 13 \(amd64\)" asset for 1\.3\.0~rc1; trying older/);
  assert.match(result.stderr, /v1\.2\.11 has no single .* asset for 1\.2\.11; trying older/);
  assert.match(result.stderr, /tokkl-kde_1\.2\.10_amd64\.deb from v1\.2\.10, SHA-256 [0-9a-f]{64}, for the upgrade to 1\.3\.0\n$/);
});

test('passes over a release with two RPMs for the target and RPMs it cannot name', (t) => {
  const box = fixture(t, [
    { tag: 'v1.2.2', assets: [rpm('1.2.2', 'fc43'), rpm('1.2.2', 'fc44')] },
    { tag: 'v1.2.1', assets: [deb('1.2.1'), rpm('1.2.1', 'fc44.debug'), rpm('1.2.1', 'fc44'), rpm('1.2.1', 'fc45', { state: 'open' })] },
  ]);
  const result = box.run('rpm', '1.2.3');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${join(result.output, 'tokkl-kde-1.2.1-1.fc44.x86_64.rpm')}\n`);
  assert.deepEqual(result.left, ['tokkl-kde-1.2.1-1.fc44.x86_64.rpm']);
  assert.match(result.stderr, /v1\.2\.2 has no single "tokkl-kde RPM for Fedora KDE 44 \(x86_64\)" asset/);
});

test('falls back when gh is not installed', (t) => {
  const box = fixture(t, [{ tag: 'v1.2.2', assets: [deb('1.2.2')] }]);
  // Only the tools the script needs before it looks for gh, so no gh on PATH at all.
  const tools = join(box.root, 'tools');
  mkdirSync(tools);
  for (const tool of ['bash', 'dirname']) {
    symlinkSync(execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), join(tools, tool));
  }
  const result = box.run('deb', '1.2.3', tools);
  assertFallback(result, /^previous package: gh is not installed;/);
  assert.deepEqual(result.gh, []);
});

test('falls back when the releases cannot be listed', (t) => {
  const box = fixture(t, [{ tag: 'v1.2.2', assets: [deb('1.2.2')] }]);
  box.mark('fail-list');
  assertFallback(box.run('deb', '1.2.3'), /cannot list the releases \(HTTP 403: Resource not accessible\);/);
});

test('falls back when there are no releases', (t) => {
  assertFallback(fixture(t, []).run('deb', '1.2.3'), /no published release older than 1\.2\.3 has a "tokkl-kde DEB for Debian 13 \(amd64\)" asset;/);
});

test('falls back when the assets of the release cannot be read', (t) => {
  const box = fixture(t, [{ tag: 'v1.2.2', assets: [deb('1.2.2')] }, { tag: 'v1.2.1', assets: [deb('1.2.1')] }]);
  box.forget('v1.2.2');
  const result = box.run('deb', '1.2.3');
  assertFallback(result, /cannot read the assets of v1\.2\.2;/);
  assert.equal(result.gh.filter((call) => call.startsWith('release view')).length, 1);
});

test('falls back when no older release has a package for the target', (t) => {
  const box = fixture(t, [
    { tag: 'v1.3.0', assets: [deb('1.3.0')] },
    { tag: 'v1.2.3', assets: [deb('1.2.3')] },
    { tag: 'v1.2.2', assets: [deb('1.2.2', { label: 'tokkl-kde DEB for Debian 12 (amd64)' })] },
    { tag: 'v1.2.1', assets: [rpm('1.2.1')] },
  ]);
  const result = box.run('deb', '1.2.3');
  assertFallback(result, /no published release older than 1\.2\.3 has a "tokkl-kde DEB for Debian 13 \(amd64\)" asset;/);
  assert.equal(result.gh.some((call) => call.startsWith('release download')), false);
});

for (const partial of [false, true]) {
  test(`falls back when the download fails${partial ? ' after writing part of the file' : ''}`, (t) => {
    const box = fixture(t, [{ tag: 'v1.2.2', assets: [deb('1.2.2')] }]);
    box.mark('fail-download');
    if (partial) box.mark('partial');
    const result = box.run('deb', '1.2.3');
    assertFallback(result, /downloading tokkl-kde_1\.2\.2_amd64\.deb from v1\.2\.2 failed;/);
    assert.match(result.stderr, /connection reset/);
  });
}

for (const [what, asset] of [
  ['size', deb('1.2.2', { size: 999 })],
  ['SHA-256', deb('1.2.2', { digest: `sha256:${sha256('something else')}` })],
] as const) {
  test(`fails, leaving nothing behind, when the download does not match its published ${what}`, (t) => {
    const box = fixture(t, [{ tag: 'v1.2.2', assets: [asset] }]);
    const result = box.run('deb', '1.2.3');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^error: tokkl-kde_1\.2\.2_amd64\.deb from v1\.2\.2 does not match its published size \d+ and SHA-256 [0-9a-f]{64}$/m);
    assert.doesNotMatch(result.stderr, FALLBACK);
    assert.deepEqual(result.left, []);
  });
}

test('removes a stale file of the same name when the download does not verify', (t) => {
  const box = fixture(t, [{ tag: 'v1.2.2', assets: [deb('1.2.2', { size: 999 })] }]);
  const output = join(box.root, 'previous');
  mkdirSync(output);
  writeFileSync(join(output, 'tokkl-kde_1.2.2_amd64.deb'), 'stale');
  const result = box.run('deb', '1.2.3');
  assert.equal(result.status, 1);
  assert.deepEqual(result.left, []);
});
