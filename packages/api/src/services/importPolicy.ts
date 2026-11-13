import { ApplicationError, invalidInput } from '../lib/errors.ts';

/** Per upload: JSON records, or CSV data rows without the header. */
export const MAX_IMPORT_RECORDS = 10_000;
/** Per upload: JSON values at any depth, or CSV cells including the header's. */
export const MAX_IMPORT_VALUES = 250_000;
/** JSON containers, the root included. */
export const MAX_IMPORT_DEPTH = 32;

const RECORDS_MESSAGE = `At most ${MAX_IMPORT_RECORDS} records per import`;
const VALUES_MESSAGE = `At most ${MAX_IMPORT_VALUES} values per import`;
const DEPTH_MESSAGE = `At most ${MAX_IMPORT_DEPTH} levels of nesting per import`;

/** A 400 that per-record error collectors can tell apart from a refused record. */
export const importLimit = (message: string) => invalidInput(message, { code: 'import_limit' });

export function isImportLimit(error: unknown): boolean {
  return error instanceof ApplicationError && error.validation?.code === 'import_limit';
}

type Item = Record<string, unknown>;

/** Every record counts, including one the import would skip as invalid. */
function checkRecords(file: Item, fields: readonly string[]): void {
  let records = 0;
  for (const field of fields) {
    const value = file[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw invalidInput(`Invalid export file: "${field}" must be an array`);
    records += value.length;
  }
  if (records > MAX_IMPORT_RECORDS) throw importLimit(RECORDS_MESSAGE);
}

/** Iterative, so a deep file cannot exhaust the call stack. Stops at the first value past a limit. */
function checkValues(root: unknown): void {
  let values = 1;
  const stack: Array<{ container: object; depth: number }> = [];
  const visit = (value: unknown, depth: number) => {
    if (typeof value !== 'object' || value === null) return;
    if (depth > MAX_IMPORT_DEPTH) throw importLimit(DEPTH_MESSAGE);
    stack.push({ container: value, depth });
  };
  visit(root, 1);
  for (let next = stack.pop(); next; next = stack.pop()) {
    const children: unknown[] = Array.isArray(next.container) ? next.container : Object.values(next.container);
    for (const child of children) {
      if (++values > MAX_IMPORT_VALUES) throw importLimit(VALUES_MESSAGE);
      visit(child, next.depth + 1);
    }
  }
}

/** Run on the parsed file before the import's transaction opens. `fields` name the record arrays. */
export function checkJsonImport(file: Item, fields: readonly string[]): void {
  checkRecords(file, fields);
  checkValues(file);
}
