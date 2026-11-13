/** RFC 4180. */
import { setImmediate as nextTurn } from 'node:timers/promises';

export interface CsvLimits {
  /** The header counts; blank rows are dropped and not counted. */
  maxRows: number;
  maxFieldsPerRow: number;
  maxFieldLength: number;
  /** Every cell read, blank rows' included. */
  maxCells: number;
}

export class CsvLimitError extends Error {
  readonly limit: keyof CsvLimits;
  constructor(limit: keyof CsvLimits) {
    super(`CSV limit exceeded: ${limit}`);
    this.name = 'CsvLimitError';
    this.limit = limit;
  }
}

const UNLIMITED: CsvLimits = {
  maxRows: Infinity,
  maxFieldsPerRow: Infinity,
  maxFieldLength: Infinity,
  maxCells: Infinity,
};
const BATCH_CHARACTERS = 1 << 16;
const SPECIAL = /[",\r\n]/g;

/** Drops blank rows and a BOM; quotes open only at a value's start. Yields as it reads; throws `CsvLimitError`. */
export async function parseCsv(text: string, limits: Partial<CsvLimits> = {}): Promise<string[][]> {
  const { maxRows, maxFieldsPerRow, maxFieldLength, maxCells } = { ...UNLIMITED, ...limits };
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let cells = 0;
  let nextYield = BATCH_CHARACTERS;

  const append = (part: string) => {
    if (field.length + part.length > maxFieldLength) throw new CsvLimitError('maxFieldLength');
    field += part;
  };
  const endField = () => {
    if (row.length >= maxFieldsPerRow) throw new CsvLimitError('maxFieldsPerRow');
    if (cells >= maxCells) throw new CsvLimitError('maxCells');
    cells++;
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
