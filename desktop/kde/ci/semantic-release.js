/**
 * semantic-release plugin that builds the tokkl-kde DEB and RPM for the release being made, so they
 * carry the shared Tokkl version and are attached to the same v<version> GitHub release.
 *
 * - verifyConditions: the container engine answers.
 * - verifyRelease: scripts/native-version.sh accepts the next version, before the changelog,
 *   package.json, tag or release are written.
 * - prepare: scripts/container-check.sh builds both packages for the next version in the pinned
 *   images and checks them: CTest, installation, loading under Xvfb and DBus, upgrade and
 *   removal. They land in dist/kde, where @semantic-release/github finds them. This plugin runs
 *   before @semantic-release/git, so a failure stops the release before anything is pushed.
 *
 * CONTAINER_ENGINE defaults to docker, as in container-check.sh.
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KDE_DIR = 'desktop/kde';
const OUTPUT_DIR = 'dist/kde';

function run(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

export async function verifyConditions(pluginConfig, { cwd, env, logger }) {
  const engine = env.CONTAINER_ENGINE || 'docker';
  await run(engine, ['version', '--format', '{{.Server.Version}}'], { cwd, env });
  logger.log('%s is available to build the KDE packages', engine);
}

export async function verifyRelease(pluginConfig, { cwd, env, nextRelease, logger }) {
  const native = await run(join(KDE_DIR, 'scripts/native-version.sh'), [nextRelease.version], { cwd, env });
  logger.log('KDE packages for %s will have version %s', nextRelease.version, native);
}

export async function prepare(pluginConfig, { cwd, env, nextRelease, logger }) {
  const output = join(cwd, OUTPUT_DIR);
  // Only this release's packages may be attached.
  rmSync(output, { recursive: true, force: true });
  await run(join(KDE_DIR, 'scripts/container-check.sh'), ['--version', nextRelease.version, '--output', output], { cwd, env });

  const native = await run(join(KDE_DIR, 'scripts/native-version.sh'), [nextRelease.version], { cwd, env });
  const files = readdirSync(output).filter((name) => name.endsWith('.deb') || name.endsWith('.rpm')).sort();
  const deb = `tokkl-kde_${native}_amd64.deb`;
  const rpm = files.find((name) => name.startsWith(`tokkl-kde-${native}-1.`) && name.endsWith('.x86_64.rpm'));
  if (files.length !== 2 || !files.includes(deb) || !rpm) {
    throw new Error(`Expected ${deb} and one tokkl-kde-${native}-1.*.x86_64.rpm in ${OUTPUT_DIR}, found: ${files.join(', ') || 'nothing'}`);
  }
  logger.log('Built and checked %s and %s', deb, rpm);
}
