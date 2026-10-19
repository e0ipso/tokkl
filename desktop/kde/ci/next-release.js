/**
 * Prints the version the next release will have, or nothing when the commits since the last release
 * warrant none, from a semantic-release dry run with the repository's configuration. The release
 * workflow builds the KDE packages for this version before semantic-release runs for real.
 *
 *   node desktop/kde/ci/next-release.js
 *
 * semantic-release's own log goes to stderr, so stdout holds only the version. The dry run runs the
 * verifyConditions, analyzeCommits, verifyRelease and generateNotes steps of every plugin and writes
 * nothing; it still checks that it could push, so it needs the same token as a real release.
 */
import semanticRelease from 'semantic-release';

const result = await semanticRelease({ dryRun: true }, { stdout: process.stderr, stderr: process.stderr });
if (result) process.stdout.write(`${result.nextRelease.version}\n`);
