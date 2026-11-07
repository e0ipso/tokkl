import type { Repositories } from '../../src/storage/contracts.ts';
import { assembleCsvExport, assembleJsonExport } from '../../src/services/exports.ts';

/** Anything that opens a read snapshot over the transfer repository. */
export interface ExportRunner {
  readSnapshot<T>(work: (repositories: Pick<Repositories, 'transfers'>) => Promise<T>): Promise<T>;
}

/** The export projection, read the way the export routes read it: in one snapshot. */
export function collectAccountExport(runner: ExportRunner, userId: number) {
  return runner.readSnapshot(repositories => repositories.transfers.exportAccount(userId));
}

export async function buildJsonExport(runner: ExportRunner, userId: number) {
  return assembleJsonExport(await collectAccountExport(runner, userId));
}

export async function buildCsvExport(runner: ExportRunner, userId: number, range: { from?: string; to?: string }) {
  return assembleCsvExport(await collectAccountExport(runner, userId), range);
}
