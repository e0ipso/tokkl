import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// check-tracker-refs.ts scans the git repository around its own location, so each test copies the
// script into a throwaway git repository and runs it there. Nothing touches the real checkout.
// The fixtures build the forbidden strings from parts: a literal ticket ID or plan path in this file
// would trip the check on the repository that holds it.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'check-tracker-refs.ts');

const ticket = (n: string) => ['TT', n].join('-');
const PLANS = ['.ai', 'strikethroo', 'plans'].join('/');
const CLEAN_MESSAGE = 'No ticket or plan references in tracked files.';

type Fixture = { root: string; write: (path: string, content: string | Buffer) => void };

/** A git repository holding a copy of the script, deleted when the test ends. */
function repo(t: { after: (fn: () => void) => void }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-tracker-refs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  mkdirSync(join(root, 'scripts'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'check-tracker-refs.ts'));
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  return { root, write };
}

/** Environment without the GIT_* variables a hook or a parent git command would leak in. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return env;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, env: cleanEnv(), stdio: 'pipe' });
}

/** Stage everything so `git ls-files` lists it. The script reads the index, not a commit. */
function track(root: string): void {
  git(root, 'add', '-A', '--force');
}

function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-tracker-refs.ts')], {
    cwd: root,
    env: cleanEnv(),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The `path:line` hit lines the script prints, without the summary and the hint. */
function hitLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => /:\d+$/.test(line));
}

test('a repository with no references passes and says so', (t) => {
  const { root, write } = repo(t);
  write('README.md', 'Plain prose.\nNothing to see.\n');
  write('src/a.ts', 'export const a = 1;\n');
  track(root);
  const result = run(root);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), CLEAN_MESSAGE);
  assert.equal(result.stderr, '');
});

test('a ticket ID is reported as file:line with a singular summary and exit 1', (t) => {
  const { root, write } = repo(t);
  write('src/a.ts', `// first\n// second\n// waits on ${ticket('0042')}\n`);
  track(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(hitLines(result.stderr), ['src/a.ts:3']);
  assert.match(result.stderr, /^1 tracked line cite a ticket ID or a plan path:/);
  assert.match(result.stderr, /add the path to EXCLUDED in scripts\/check-tracker-refs\.ts/);
});

test('a plan path is reported and several hits across files use the plural summary', (t) => {
  const { root, write } = repo(t);
  write('docs/a.md', `see ${PLANS}/12/plan.md\n`);
  write('docs/b.md', `ok\n${ticket('7')} and ${ticket('9')} on one line\n`);
  track(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(hitLines(result.stderr), ['docs/a.md:1', 'docs/b.md:2']);
  assert.match(result.stderr, /^2 tracked lines cite a ticket ID or a plan path:/);
});

test('every ticket pattern edge: digit count, word boundaries and near misses', (t) => {
  const { root, write } = repo(t);
  const lines = [
    `${ticket('1')}`, //                    1 match: one digit is enough
    `(${ticket('123456')})`, //             2 match: long IDs, punctuation boundary
    `x ${ticket('0001')}.`, //              3 match: trailing period
    `A${ticket('0001')}`, //                4 miss: letter before TT
    `${ticket('0001')}x`, //                5 miss: letter after the digits
    `${ticket('0001')}_`, //                6 miss: underscore is a word character
    `TT-`, //                               7 miss: no digits
    `tt-0001`, //                           8 miss: pattern is case sensitive
    `T${ticket('0001')}`, //                9 miss: extra letter
    `${ticket('')}x`, //                    10 miss
    `TT 0001`, //                           11 miss: no hyphen
  ];
  write('notes.txt', lines.join('\n') + '\n');
  track(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(hitLines(result.stderr), ['notes.txt:1', 'notes.txt:2', 'notes.txt:3']);
});

test('a partial plan path does not match', (t) => {
  const { root, write } = repo(t);
  write('a.md', ['.ai/strikethroo', '.ai/sift/plans', 'strikethroo/plans'].join('\n') + '\n');
  track(root);
  assert.equal(run(root).status, 0);
});

test('files under the excluded paths are skipped, near-miss paths are not', (t) => {
  const { root, write } = repo(t);
  const body = `cites ${ticket('0001')} and ${PLANS}/1\n`;
  for (const path of [
    '.ai/sift/tickets/x.md',
    '.agents/skills/s/SKILL.md',
    '.claude/settings.json',
    '.cursor/rules/r.mdc',
    '.codex/config.toml',
    'skills-lock.json',
    '.kkignore',
  ]) {
    write(path, body);
  }
  write('clean.md', 'fine\n');
  track(root);
  const skipped = run(root);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout.trim(), CLEAN_MESSAGE);

  // Directory entries match by prefix only at the repository root, and file entries match exactly.
  const near = [
    '.ai-notes/x.md',
    'docs/.ai/x.md',
    'packages/.claude/x.md',
    '.aiX/x.md',
    'skills-lock.json.bak',
    'sub/skills-lock.json',
    '.kkignore.old',
  ];
  for (const path of near) write(path, body);
  track(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(hitLines(result.stderr).sort(), near.map((path) => `${path}:1`).sort());
});

test('untracked and gitignored files are not scanned', (t) => {
  const { root, write } = repo(t);
  write('.gitignore', 'ignored.md\n');
  write('tracked.md', 'clean\n');
  track(root);
  write('untracked.md', `${ticket('0001')}\n`);
  write('ignored.md', `${ticket('0001')}\n`);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('a staged hit is found even before it is committed, a hit removed from the index is not', (t) => {
  const { root, write } = repo(t);
  write('a.md', `${ticket('5')}\n`);
  track(root);
  assert.equal(run(root).status, 1);
  git(root, 'rm', '-q', '--cached', 'a.md');
  assert.equal(run(root).status, 0);
});

test('paths with spaces, quotes and non-ASCII characters are listed intact', (t) => {
  const { root, write } = repo(t);
  const names = ['has space.md', 'quo"te.md', 'café/über ☃.md'];
  for (const name of names) write(name, `${ticket('3')}\n`);
  track(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.deepEqual(hitLines(result.stderr).sort(), names.map((name) => `${name}:1`).sort());
});

test('binary files are skipped even when they contain a reference', (t) => {
  const { root, write } = repo(t);
  write('image.bin', Buffer.concat([Buffer.from(`${ticket('0001')}\n`), Buffer.from([0, 1, 2, 3])]));
  write('text.md', 'clean\n');
  track(root);
  assert.equal(run(root).status, 0);
});

test('a NUL byte past the first chunk still marks the file binary', (t) => {
  const { root, write } = repo(t);
  write('late.bin', Buffer.concat([Buffer.from(`${ticket('0001')}\n`), Buffer.alloc(200_000, 0x61), Buffer.from([0])]));
  track(root);
  assert.equal(run(root).status, 0);
});

test('a tracked symlink is not followed to the file it points at', (t) => {
  const { root, write } = repo(t);
  write('target.md', 'clean\n');
  symlinkSync('target.md', join(root, 'link.md'));
  // A link to a file outside the repository, and a dangling link, must not crash the scan.
  const outside = mkdtempSync(join(tmpdir(), 'tokkl-tracker-refs-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'secret.md'), `${ticket('0001')}\n`);
  symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'));
  symlinkSync('missing.md', join(root, 'dangling.md'));
  track(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('a tracked file deleted from the working tree is skipped, not fatal', (t) => {
  const { root, write } = repo(t);
  write('gone.md', `${ticket('0001')}\n`);
  write('kept.md', 'clean\n');
  track(root);
  unlinkSync(join(root, 'gone.md'));
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), CLEAN_MESSAGE);
});

test('the working-tree content is scanned, not the staged blob', (t) => {
  const { root, write } = repo(t);
  write('a.md', 'clean\n');
  track(root);
  write('a.md', `${ticket('8')}\n`);
  assert.equal(run(root).status, 1);
});

test('a CRLF file reports the right line and a file without a trailing newline is scanned', (t) => {
  const { root, write } = repo(t);
  write('crlf.md', `one\r\ntwo\r\n${ticket('4')}\r\n`);
  write('nonl.md', `one\n${ticket('4')}`);
  track(root);
  const result = run(root);
  assert.deepEqual(hitLines(result.stderr), ['crlf.md:3', 'nonl.md:2']);
});

test('an unreadable tracked file fails loudly instead of passing', (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read any file');
  const { root, write } = repo(t);
  write('locked.md', 'clean\n');
  track(root);
  chmodSync(join(root, 'locked.md'), 0o000);
  const result = run(root);
  chmodSync(join(root, 'locked.md'), 0o644);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EACCES/);
  assert.doesNotMatch(result.stdout, /No ticket or plan references/);
});

test('outside a git repository the script fails instead of reporting a clean tree', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-tracker-refs-nogit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'check-tracker-refs.ts'));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /No ticket or plan references/);
});

test('an empty repository passes', (t) => {
  const { root } = repo(t);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('the gate is wired into npm, CI and the README', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['check:tracker-refs'], 'node scripts/check-tracker-refs.ts');

  const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const typecheck = ci.indexOf('- run: npm run typecheck');
  const gate = ci.indexOf('- run: npm run check:tracker-refs');
  const unit = ci.indexOf('- run: npm test');
  assert.ok(typecheck >= 0 && gate > typecheck && unit > gate, 'check:tracker-refs runs after typecheck and before npm test');

  assert.match(readFileSync(join(REPO_ROOT, 'README.md'), 'utf8'), /check:tracker-refs/);
});
