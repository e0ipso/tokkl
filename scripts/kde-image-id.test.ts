import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// desktop/kde/ci/image-id.sh hashes files next to itself, so each test copies the tracked files of
// desktop/kde to a throwaway directory, changes one input there and runs the copy.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TRACKED = execFileSync('git', ['ls-files', 'desktop/kde'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
const DOCKERFILE = { deb: 'ci/Dockerfile', 'ubuntu-deb': 'ci/ubuntu.Dockerfile', rpm: 'ci/fedora.Dockerfile' } as const;

/** The sources of the Dockerfile's COPY instructions, relative to desktop/kde. */
function copied(format: keyof typeof DOCKERFILE): string[] {
  const lines = readFileSync(join(ROOT, 'desktop', 'kde', DOCKERFILE[format]), 'utf8').split('\n');
  return lines.filter((line) => /^COPY\s/i.test(line)).flatMap((line) => line.trim().split(/\s+/).slice(1, -1));
}

function tree(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-kde-image-id-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of new Set([...TRACKED, ...Object.values(DOCKERFILE).map((name) => `desktop/kde/${name}`)])) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(ROOT, file), target);
    chmodSync(target, statSync(join(ROOT, file)).mode);
  }
  const kde = join(root, 'desktop', 'kde');
  const id = (format: keyof typeof DOCKERFILE, refresh?: string) => {
    const result = spawnSync(join(kde, 'ci', 'image-id.sh'), ['--format', format], {
      env: { PATH: process.env.PATH, ...(refresh === undefined ? {} : { TOKKL_KDE_CI_REFRESH: refresh }) },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^[0-9a-f]{64}\n$/);
    return result.stdout.trim();
  };
  const touch = (file: string) => appendFileSync(join(kde, file), '\n# changed\n');
  return { kde, id, touch };
}

for (const format of ['deb', 'ubuntu-deb', 'rpm'] as const) {
  test(`${format}: the identity is stable when nothing that goes into the images changes`, (t) => {
    const box = tree(t);
    const before = box.id(format, '2026-W42');
    assert.equal(box.id(format, '2026-W42'), before);
    // Sources the images do not copy, and the other format's Dockerfile.
    for (const file of ['CMakeLists.txt', 'scripts/container-check.sh', 'ci/image-id.sh',
      ...Object.entries(DOCKERFILE).filter(([name]) => name !== format).map(([, name]) => name)]) {
      box.touch(file);
      assert.equal(box.id(format, '2026-W42'), before, file);
    }
  });

  test(`${format}: the identity changes with the Dockerfile and with each file it copies`, (t) => {
    const sources = copied(format);
    assert.ok(sources.includes('ci/baseline.sh') && sources.length >= 3, `unexpected COPY sources: ${sources.join(', ')}`);
    const box = tree(t);
    const seen = new Set([box.id(format)]);
    for (const file of [DOCKERFILE[format], ...sources]) {
      box.touch(file);
      const next = box.id(format);
      assert.ok(!seen.has(next), `${file} did not change the identity`);
      seen.add(next);
    }
  });

  test(`${format}: the identity changes with TOKKL_KDE_CI_REFRESH`, (t) => {
    const box = tree(t);
    const unset = box.id(format);
    assert.equal(box.id(format, ''), unset);
    const week = box.id(format, '2026-W42');
    assert.notEqual(week, unset);
    assert.notEqual(box.id(format, '2026-W43'), week);
  });
}

test('the DEB and RPM images have different identities', (t) => {
  const box = tree(t);
  assert.notEqual(box.id('deb'), box.id('rpm'));
});
