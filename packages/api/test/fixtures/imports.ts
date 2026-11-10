import type { EntryRepositories } from '../../src/domain/entryAccess.ts';
import type { TimerPublication } from '../../src/domain/timerSettlement.ts';
import type { ImportRunner } from '../../src/services/importGuards.ts';
import { createImportOperations, type ImportOptions } from '../../src/services/importJson.ts';

export function importsById<R extends EntryRepositories>(runner: ImportRunner<R>, publish: TimerPublication) {
  const forUser = (userId: number) => createImportOperations(runner, userId, publish);
  return {
    importJsonExport: (userId: number, data: unknown, options: ImportOptions) =>
      forUser(userId).importJsonExport(data, options),
    importTogglCsv: (userId: number, text: string, options: ImportOptions & { users?: string[] }) =>
      forUser(userId).importTogglCsv(text, options),
  };
}
