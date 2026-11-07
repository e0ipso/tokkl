/** RFC 4180 CSV parsing and writing. */
import { setImmediate as nextTurn } from 'node:timers/promises';

/** Bounds on what a parse may hold. A file that passes one is refused while it is read. */
export interface CsvLimits {
  /** Rows with a non-blank value, the header included. Blank rows are dropped and not counted. */
  maxRows: number;
  maxFieldsPerRow: number;
  /** Characters in one value. */
  maxFieldLength: number;
}

/** The parse stopped at `limit`. */
export class CsvLimitError extends Error {
  readonly limit: keyof CsvLimits;
  constructor(limit: keyof CsvLimits) {
    super(`CSV limit exceeded: ${limit}`);
    this.name = 'CsvLimitError';
    this.limit = limit;
  }
}

const UNLIMITED: CsvLimits = { maxRows: Infinity, maxFieldsPerRow: Infinity, maxFieldLength: Infinity };
/** Characters read between turns given back to the event loop. */
const BATCH_CHARACTERS = 1 << 16;
/** The characters that end a stretch of plain text outside quotes. */
const SPECIAL = /[",\r\n]/g;

/**
 * Parses CSV text into rows of values, dropping rows whose values are all blank. A leading BOM is
 * ignored. A quote opens a quoted value only as a value's first character; text after the closing
 * quote is part of the value. The parse gives the event loop a turn after each stretch of text it
 * reads, and refuses the file with a `CsvLimitError` as soon as it passes one of `limits`.
 */
export async function parseCsv(text: string, limits: Partial<CsvLimits> = {}): Promise<string[][]> {
  const { maxRows, maxFieldsPerRow, maxFieldLength } = { ...UNLIMITED, ...limits };
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let nextYield = BATCH_CHARACTERS;

  const append = (part: string) => {
    if (field.length + part.length > maxFieldLength) throw new CsvLimitError('maxFieldLength');
    field += part;
  };
  const endField = () => {
    if (row.length >= maxFieldsPerRow) throw new CsvLimitError('maxFieldsPerRow');
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some(value => value.trim() !== '')) {
      if (rows.length >= maxRows) throw new CsvLimitError('maxRows');
      rows.push(row);
    }
    row = [];
  };

  let i = 0;
  while (i < input.length) {
    if (i >= nextYield) {
      await nextTurn();
      nextYield = i + BATCH_CHARACTERS;
    }
    if (quoted) {
      const close = input.indexOf('"', i);
      if (close < 0) {
        append(input.slice(i));
        break;
      }
      append(input.slice(i, close));
      if (input[close + 1] === '"') {
        append('"');
        i = close + 2;
      } else {
        quoted = false;
        i = close + 1;
      }
      continue;
    }
    SPECIAL.lastIndex = i;
    const special = SPECIAL.exec(input);
    const at = special ? special.index : input.length;
    if (at > i) {
      append(input.slice(i, at));
      i = at;
      continue;
    }
    const char = input[i]!;
    if (char === '"') {
      // A quote inside a value is a plain character.
      if (field === '') quoted = true;
      else append(char);
    } else if (char === ',') {
      endField();
    } else {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    }
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function escapeField(value: string): string {
  // A leading =, +, - or @ makes spreadsheet apps evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return (
    rows
      .map(row => row.map(value => escapeField(value === null || value === undefined ? '' : String(value))).join(','))
      .join('\r\n') + '\r\n'
  );
}
