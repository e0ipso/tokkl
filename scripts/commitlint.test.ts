import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import lint from '@commitlint/lint';
import load from '@commitlint/load';

// Loads commitlint.config.js and lints messages through commitlint's own API, with the options
// @commitlint/cli builds for a loaded config. Ticket IDs are built from parts: a literal ID in a
// tracked file would fail `npm run check:tracker-refs`.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ticket = (n: string) => ['TT', n].join('-');
const ID = ticket('0001');
const CO_AUTHOR = 'Co-authored-by: Jane <jane@example.com>';
const AI_CREDIT = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

type Config = Awaited<ReturnType<typeof load>>;
type Report = Awaited<ReturnType<typeof lint>>;

// The hook runs `commitlint --edit`, which also sets the comment character to git's default.
const lintOptions = (config: Config) => ({
  parserOpts: { ...(config.parserPreset?.parserOpts as object | undefined), commentChar: '#' },
  plugins: config.plugins ?? {},
  ignores: config.ignores ?? [],
  defaultIgnores: config.defaultIgnores !== false,
});

const failedRules = (report: Report) => report.errors.map(error => error.name).sort();
const show = (message: string) => JSON.stringify(message);

describe('commitlint.config.js', () => {
  let config: Config;
  const lintMessage = (message: string) => lint(message, config.rules, lintOptions(config));

  const assertFails = async (message: string, rules: string[]) => {
    const report = await lintMessage(message);
    assert.equal(report.valid, false, show(message));
    const failed = failedRules(report);
    for (const rule of rules) {
      assert.ok(failed.includes(rule), `${show(message)} failed ${failed}, not ${rule}`);
    }
  };

  const assertPasses = async (message: string) => {
    const report = await lintMessage(message);
    assert.deepEqual(report.errors, [], show(message));
    assert.equal(report.valid, true, show(message));
  };

  before(async () => {
    config = await load({}, { cwd: REPO_ROOT });
  });

  test('loads with both custom rules set to error and the default ignores off', () => {
    assert.deepEqual(config.rules['no-ticket-id-in-header'], [2, 'always']);
    assert.deepEqual(config.rules['no-ai-generated'], [2, 'always']);
    assert.equal(config.defaultIgnores, false);
  });

  test('package.json declares every package the config imports', () => {
    const source = readFileSync(join(REPO_ROOT, 'commitlint.config.js'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
    const packages = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)]
      .map(match => match[1] ?? '')
      .filter(specifier => specifier && !specifier.startsWith('.') && !specifier.startsWith('node:'))
      .map(specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
    assert.ok(packages.length > 0, 'no package import found in commitlint.config.js');
    for (const name of packages) {
      assert.ok(declared.has(name), `${name} is imported by commitlint.config.js but not in package.json`);
    }
  });

  describe('ordinary commits', () => {
    test('rejects a ticket ID in the header', async () => {
      for (const message of [`feat: implement ${ID}`, `feat(${ID}): add x`]) {
        assert.deepEqual(failedRules(await lintMessage(message)), ['no-ticket-id-in-header'], message);
      }
    });

    test('rejects a co-author or AI credit trailer', async () => {
      for (const message of [`feat: add x\n\n${CO_AUTHOR}`, `feat: add x\n\n${AI_CREDIT}`]) {
        assert.deepEqual(failedRules(await lintMessage(message)), ['no-ai-generated'], message);
      }
    });

    test('accepts a ticket ID in a Refs trailer', async () => {
      await assertPasses(`feat: add x\n\nRefs: ${ID}`);
    });
  });

  describe('messages commitlint ignores by default', () => {
    test('rejects a ticket ID in the header of a revert, reapply, fixup!, squash! or amend!', async () => {
      for (const message of [
        `Revert "feat: implement ${ID}"`,
        `revert "feat: implement ${ID}"`,
        `Reapply "feat: implement ${ID}"`,
        `fixup! feat: implement ${ID}`,
        `squash! feat: implement ${ID}`,
        `amend! feat: implement ${ID}`,
        `Merge branch '${ID}-x'`,
      ]) {
        await assertFails(message, ['no-ticket-id-in-header']);
      }
    });

    test('rejects a co-author or AI credit trailer on a revert, fixup, squash or merge', async () => {
      for (const subject of [
        'Revert "feat: add x"',
        'fixup! feat: add x',
        'squash! feat: add x',
        "Merge branch 'topic'",
        'Merge topic into main',
        'Merge pull request #1 from a/b',
      ]) {
        for (const trailer of [CO_AUTHOR, AI_CREDIT]) {
          await assertFails(`${subject}\n\n${trailer}`, ['no-ai-generated']);
        }
      }
    });

    test('rejects a message that fails both custom checks on both rules', async () => {
      await assertFails(`Revert "feat: implement ${ID}"\n\n${CO_AUTHOR}`, ['no-ai-generated', 'no-ticket-id-in-header']);
    });

    test('still accepts the same shapes without a ticket ID or credit', async () => {
      for (const message of [
        'Revert "feat: add x"',
        `Revert "feat: add x"\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.\n\nRefs: ${ID}`,
        'Reapply "feat: add x"',
        'fixup! feat: add x',
        'squash! feat: add x\n\nFold the retry into the first commit.',
        'amend! feat: add x',
        "Merge branch 'x'",
        "Merge branch 'topic'\n\n* topic:\n  fix: handle z",
        "Merge branch 'topic'\r\n\r\n# Conflicts:\r\n#\tfile.txt",
        'Merge pull request #1 from a/b\n\nAdd the thing',
        "Merge tag 'v1.0'",
        "Merge remote-tracking branch 'origin/main'",
        'Merge topic into main',
        '1.4.0',
      ]) {
        await assertPasses(message);
      }
    });
  });

  describe('merge subjects count only on the first line', () => {
    test('rejects a non-Conventional subject with a merge line in the body', async () => {
      for (const message of [
        "did stuff\n\nMerge branch 'main' into x",
        'did stuff\n\nMerge branch y',
        'did stuff\r\n\r\nMerge branch y',
        'did stuff\n\nMerge pull request #1 from a/b',
        "did stuff\n\nMerge tag 'v1.0'",
        'did stuff\n\nMerge x into y',
      ]) {
        await assertFails(message, ['subject-empty', 'type-empty']);
      }
    });
  });
});

// Runs real `git commit` and `git merge` through .husky/commit-msg in a throwaway repository, so a
// broken hook, a missing `prepare` step or a message git itself writes cannot slip past the config.
describe('commit-msg hook in a throwaway repository', () => {
  let fixture: string | undefined;
  let repo = '';
  let env: NodeJS.ProcessEnv = {};

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  const tryGit = (args: string[], input?: string) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', input });
  const head = () => git('rev-parse', 'HEAD');
  // Setup commits skip the hook; only the commit or merge under test runs it.
  const setupCommit = (message: string) => git('commit', '-q', '--allow-empty', '--no-verify', '-m', message);
  const commit = (message: string) => tryGit(['commit', '--allow-empty', '--file=-'], message);
  const output = (result: ReturnType<typeof tryGit>) => `${result.stdout}${result.stderr}`;

  const assertRefused = (result: ReturnType<typeof tryGit>, start: string, rules: string[], label: string) => {
    assert.notEqual(result.status, 0, `${label}: ${output(result)}`);
    for (const rule of rules) {
      assert.match(output(result), new RegExp(`\\[${rule}\\]`), label);
    }
    assert.equal(head(), start, label);
  };

  const assertAccepted = (result: ReturnType<typeof tryGit>, start: string, label: string) => {
    assert.equal(result.status, 0, `${label}: ${output(result)}`);
    assert.notEqual(head(), start, label);
  };

  before(() => {
    fixture = mkdtempSync(join(tmpdir(), 'tokkl-commitlint-'));
    repo = join(fixture, 'repo');
    // No GIT_* variable, so a run from inside a git hook cannot reach this checkout, and no HUSKY,
    // so a HUSKY=0 in the caller's shell cannot turn the hook off. The global and system git
    // configs are ignored, and husky's init.sh is looked up in an empty config home.
    env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && !name.startsWith('HUSKY')),
      ),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      XDG_CONFIG_HOME: join(fixture, 'config'),
    };

    mkdirSync(join(repo, '.husky'), { recursive: true });
    for (const file of ['package.json', 'commitlint.config.js', join('.husky', 'commit-msg')]) {
      copyFileSync(join(REPO_ROOT, file), join(repo, file));
    }
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(repo, 'node_modules'));
    git('init', '-q', '-b', 'main');
    // npm ci runs this script; it is what turns the hook on.
    execFileSync('npm', ['run', '--silent', 'prepare'], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(git('config', 'core.hooksPath'), '.husky/_');
    setupCommit('chore: start');
  });

  after(() => {
    if (!fixture) {
      return;
    }
    // Remove the link first, so the recursive delete cannot follow it into the real node_modules.
    const link = join(repo, 'node_modules');
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
      unlinkSync(link);
    }
    rmSync(fixture, { recursive: true, force: true });
    assert.equal(existsSync(fixture), false, `${fixture} was not removed`);
    assert.ok(existsSync(join(REPO_ROOT, 'node_modules', '@commitlint', 'cli')), 'node_modules was deleted');
  });

  test('refuses a revert with a ticket ID and accepts the clean revert', () => {
    const body = `This reverts commit ${head()}.`;
    const start = head();
    assertRefused(commit(`Revert "feat: implement ${ID}"\n\n${body}\n`), start, ['no-ticket-id-in-header'], 'dirty');
    assertAccepted(commit(`Revert "feat: add x"\n\n${body}\n\nRefs: ${ID}\n`), start, 'clean');
  });

  for (const kind of ['fixup', 'squash']) {
    test(`refuses a ${kind}! with a co-author trailer and accepts the clean ${kind}!`, () => {
      const start = head();
      assertRefused(commit(`${kind}! feat: add x\n\n${CO_AUTHOR}\n`), start, ['no-ai-generated'], 'dirty');
      assertAccepted(commit(`${kind}! feat: add x\n`), start, 'clean');
    });
  }

  test('refuses a non-Conventional subject with a Merge line in the body', () => {
    const start = head();
    const body = "Merge branch 'main' into x";
    assertRefused(commit(`did stuff\n\n${body}\n`), start, ['subject-empty', 'type-empty'], 'dirty');
    assertAccepted(commit(`fix: handle z\n\n${body}\n`), start, 'clean');
  });

  test('runs on merges and refuses one whose header has a ticket ID', () => {
    const branch = `${ID}-x`;
    git('switch', '-q', '-c', branch, 'main');
    setupCommit('feat: add y');
    git('switch', '-q', 'main');
    const start = head();
    const result = tryGit(['merge', '--no-ff', '--no-edit', branch]);
    // Abort before asserting, so a failure here leaves no merge in progress for the next test.
    tryGit(['merge', '--abort']);
    assertRefused(result, start, ['no-ticket-id-in-header'], 'merge');
  });

  test('accepts the messages git merge --no-ff and git merge --no-ff --log write', () => {
    for (const [branch, log] of [
      ['topic', false],
      ['topic-log', true],
    ] as const) {
      git('switch', '-q', '-c', branch, 'main');
      setupCommit('feat: add z');
      setupCommit('fix: handle z');
      git('switch', '-q', 'main');
      const start = head();
      assertAccepted(tryGit(['merge', '--no-ff', ...(log ? ['--log'] : []), '--no-edit', branch]), start, branch);
      const message = git('log', '-1', '--format=%B');
      assert.match(message, new RegExp(`^Merge branch '${branch}'`), branch);
      if (log) {
        // git lists the merged commits newest first.
        assert.match(message, new RegExp(`^\\* ${branch}:\\n  fix: handle z\\n  feat: add z$`, 'm'), branch);
      }
    }
  });
});
