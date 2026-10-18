import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
