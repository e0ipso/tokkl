import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsvLimitError, parseCsv, toCsv } from '../src/lib/csv.ts';

/** A character-by-character reference parser to compare against. */
function referenceParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(value => value.trim() !== ''));
}

const limited = (limit: CsvLimitError['limit']) => (error: unknown) =>
  error instanceof CsvLimitError && error.limit === limit;

test('the parser reads quotes, line endings, a BOM and blank rows as before', async () => {
  const cases = [
    '',
    '\ufeffa,b\r\n1,2\r\n',
    'a,"b, c","say ""hi"""\n',
    '"multi\nline",x\r\r\n\n , \nlast',
    'mid"quote,"closed"after,""""\n',
    '"unclosed, to the end\n',
    ',,\n,\n"",""\n',
    'trailing,"',
  ];
  for (const text of cases) assert.deepEqual(await parseCsv(text), referenceParse(text), JSON.stringify(text));
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pieces = ['a', 'bc', ' ', '"', '""', ',', '\n', '\r', '\r\n', '\ufeff', 'x'.repeat(70_000)];
  for (let run = 0; run < 300; run++) {
    let text = '';
    const length = Math.floor(random() * 60);
    for (let i = 0; i < length; i++) text += pieces[Math.floor(random() * pieces.length)];
    assert.deepEqual(await parseCsv(text), referenceParse(text), JSON.stringify(text.slice(0, 200)));
  }
  const rows = [
    ['=1+1', 'a "quoted", value', 'line\nbreak'],
    ['', '2'],
  ];
  assert.deepEqual(await parseCsv(toCsv(rows)), [
    ["'=1+1", 'a "quoted", value', 'line\nbreak'],
    ['', '2'],
  ]);
});

test('the parser refuses a file at the first row, value or column past its limits', async () => {
  // Blank rows do not count; the limit includes the header.
  assert.equal((await parseCsv('h\n\n1\n \n2\n', { maxRows: 3 })).length, 3);
  await assert.rejects(parseCsv('h\n1\n2\n3\n', { maxRows: 3 }), limited('maxRows'));
  assert.deepEqual(await parseCsv('a,b,c\n', { maxFieldsPerRow: 3 }), [['a', 'b', 'c']]);
  await assert.rejects(parseCsv(`a${','.repeat(1_000_000)}\n`, { maxFieldsPerRow: 3 }), limited('maxFieldsPerRow'));
  assert.deepEqual(await parseCsv('"ab""c",d\n', { maxFieldLength: 4 }), [['ab"c', 'd']]);
  await assert.rejects(parseCsv('abcde\n', { maxFieldLength: 4 }), limited('maxFieldLength'));
  await assert.rejects(parseCsv('"ab""cd"\n', { maxFieldLength: 4 }), limited('maxFieldLength'));
});

test('the parser gives the event loop a turn while it reads a large file', async () => {
  const text = 'a,b,c\n'.repeat(200_000);
  let finished = false;
  const parsing = parseCsv(text).then(rows => {
    finished = true;
    return rows;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal((await parsing).length, 200_000);
});
