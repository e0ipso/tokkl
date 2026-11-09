/**
 * Account exports as report-runner jobs. A job reads the export in one read snapshot, the entries a
 * batch at a time, and hands each serialised piece to `emit` as soon as it is ready. `emit` holds
 * the job back until the reader of the output has caught up, so the history never sits in memory
 * whole: not in the worker, and not in the API process.
 */
import type { DurationFormat } from '@tokkl/types';
import { authenticatedUser, type Authentication } from '../domain/credentials.ts';
import { forbidden } from '../lib/errors.ts';
import type { Repositories, ReportCursor } from '../domain/ports.ts';
import type { EntryDetails } from '../domain/model.ts';
import { csvExportWriter, jsonExportWriter } from './exports.ts';

/** What an export writes, and the name the download gets. */
export type ExportAssemblyJob =
  | { kind: 'export-json'; exportedAt: string; filename: string }
  | { kind: 'export-csv'; range: { from?: string; to?: string }; filename: string; durationFormat?: DurationFormat };

/** An export job and whose account it reads. */
export interface ExportJobWork {
  userId: number;
  assembly: ExportAssemblyJob;
  authentication?: Authentication;
}

export type ExportRepositories = Pick<Repositories, 'users' | 'sessions' | 'transfers'>;
export interface ExportSource {
  readSnapshot<T>(work: (repositories: ExportRepositories) => Promise<T>): Promise<T>;
}

/** Takes one piece of the output; resolves once the next may follow. */
export type ExportEmitter = (chunk: string) => Promise<void>;

/** Entries an export reads and serialises at a time. */
export const EXPORT_BATCH_SIZE = 500;
/**
 * The most output bytes a worker sends ahead of what the response took. A batch is serialised
 * whole, so one batch may pass the budget before the worker waits.
 */
export const EXPORT_BYTES_AHEAD = 1024 * 1024;

const refused = () => forbidden('Incorrect username and/or password');

/** Every live entry, `order` first, a batch at a time. */
async function* exportedEntries(
  transfers: ExportRepositories['transfers'],
  userId: number,
  order: 'newest' | 'oldest',
): AsyncGenerator<EntryDetails[]> {
  let after: ReportCursor | undefined;
  for (;;) {
    const batch = await transfers.exportEntries(userId, order, after, EXPORT_BATCH_SIZE);
    if (batch.length) yield batch;
    if (batch.length < EXPORT_BATCH_SIZE) return;
    const last = batch.at(-1)!;
    after = { start: last.start, id: last.id };
  }
}

/**
 * Checks the caller, then writes the export through `emit`, all in one read snapshot. Nothing is
 * emitted before the credential and the range are checked, so those failures still get their own
 * status.
 */
export function runExportJob(source: ExportSource, work: ExportJobWork, emit: ExportEmitter): Promise<void> {
  const { userId, assembly, authentication } = work;
  return source.readSnapshot(async repositories => {
    const found = authentication
      ? authentication.user.id === userId
        ? await authenticatedUser(repositories, authentication)
        : undefined
      : await repositories.users.get(userId);
    if (!found) throw refused();
    const head = await repositories.transfers.exportHead(userId);
    if (assembly.kind === 'export-json') {
      const writer = jsonExportWriter(head, assembly.exportedAt);
      await emit(writer.opening);
      for await (const batch of exportedEntries(repositories.transfers, userId, 'newest'))
        await emit(writer.entries(batch));
      await emit(writer.closing);
      return;
    }
    const writer = csvExportWriter(head.user, assembly.range, assembly.durationFormat);
    await emit(writer.header);
    for await (const batch of exportedEntries(repositories.transfers, userId, 'oldest')) {
      const lines = writer.entries(batch);
      if (lines) await emit(lines);
    }
  });
}
