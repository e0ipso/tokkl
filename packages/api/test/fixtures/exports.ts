import type { Repositories } from '../../src/domain/ports.ts';
import { runExportJob, type ExportAssemblyJob, type ExportSource } from '../../src/services/exportJobs.ts';
import type { assembleJsonExport } from './exportOracle.ts';

/** Anything that opens a read snapshot over the transfer repository. */
export interface ExportRunner {
  readSnapshot<T>(work: (repositories: Pick<Repositories, 'transfers'>) => Promise<T>): Promise<T>;
}

/** The export projection, read the way the export routes read it: in one snapshot. */
export function collectAccountExport(runner: ExportRunner, userId: number) {
  return runner.readSnapshot(repositories => repositories.transfers.exportAccount(userId));
}

/** The body the export routes write for `assembly`, streamed by the production export job. */
export async function exportBody(source: ExportSource, userId: number, assembly: ExportAssemblyJob): Promise<string> {
  const chunks: string[] = [];
  await runExportJob(source, { userId, assembly }, async chunk => {
    chunks.push(chunk);
  });
  return chunks.join('');
}

export async function buildJsonExport(source: ExportSource, userId: number, exportedAt = new Date().toISOString()) {
  const body = await exportBody(source, userId, { kind: 'export-json', exportedAt, filename: 'tokkl.json' });
  return JSON.parse(body) as ReturnType<typeof assembleJsonExport>;
}

export function buildCsvExport(source: ExportSource, userId: number, range: { from?: string; to?: string }) {
  return exportBody(source, userId, { kind: 'export-csv', range, filename: 'tokkl.csv' });
}
