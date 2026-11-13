import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageFor } from './fixtures/database.ts';
import { catalogCounts } from './fixtures/observations.ts';
import { addUser, setup, type TestContext } from './helpers.ts';
import { ApplicationError } from '../src/lib/errors.ts';
import { createImportOperations } from '../src/services/importJson.ts';
import { isImportLimit } from '../src/services/importPolicy.ts';

const MODES = [
  ['preview', '?dry_run=true'],
  ['import', ''],
] as const;

const exportOf = (fields: Record<string, unknown>) => JSON.stringify({ format: 'tokkl-export', version: 1, ...fields });

/** Arrays nested inside the root object, `depth` containers deep in all. */
function nested(depth: number): string {
  return exportOf({ extra: JSON.parse('['.repeat(depth - 1) + ']'.repeat(depth - 1)) });
}

const postJson = (ctx: TestContext, query: string, body: string) =>
  ctx.request('POST', `/api/app/import/json${query}`, body);

const postCsv = (ctx: TestContext, query: string, body: string) =>
  ctx.request('POST', `/api/app/import/toggl-csv${query}`, body, { 'content-type': 'text/csv' });

async function accepted(response: Response, label: string): Promise<any> {
  const body = await response.json();
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(body)}`);
  return body;
}

async function refused(response: Response, message: string, label: string): Promise<void> {
  assert.equal(response.status, 400, label);
  assert.equal(response.headers.get('tokkl-error-code'), 'import_limit', label);
  assert.equal(await response.json(), message, label);
}

/** One account per mode, since an account may start only five imports in 15 minutes. */
async function importingAccounts(ctx: TestContext): Promise<Record<(typeof MODES)[number][0], TestContext>> {
  return {
    preview: await addUser(ctx, { email: 'preview@example.com', role: 'user' }),
    import: await addUser(ctx, { email: 'import@example.com', role: 'user' }),
  };
}

async function observed(ctx: TestContext) {
  return {
    counts: await catalogCounts(ctx),
    catalog: (await ctx.json('GET', `/api/app/workspaces/${ctx.wid}/catalog`)).body.revision,
    timer: (await storageFor(ctx.db).timers.getRevision(ctx.user.id))?.revision ?? 0,
  };
}

test('a JSON file of 100,001 invalid records is refused before it is read, and another account still imports', async () => {
  const ctx = await setup();
  const bob = await addUser(ctx, { email: 'bob@example.com', role: 'user' });
  const file = exportOf({ time_entries: Array.from({ length: 100_001 }, () => ({})) });
  assert.ok(file.length > 290_000 && file.length < 310_000, `${file.length} bytes`);
  const before = await observed(ctx);
  for (const [label, query] of MODES)
    await refused(await postJson(ctx, query, file), 'At most 10000 records per import', label);
  assert.deepEqual(await observed(ctx), before);

  const small = exportOf({ tags: [{ id: 1, name: 'bob tag' }] });
  assert.equal((await accepted(await postJson(bob, '', small), 'second account')).tags, 1);
});

test('JSON imports take 10,000 records across every array and refuse one more', async () => {
  const ctx = await setup();
  // Records that are not objects are skipped, yet still count.
  const records = (entries: number) =>
    exportOf({ clients: [0], projects: [0], tasks: [0], tags: [0], time_entries: Array(entries).fill(0) });
  for (const [label, query] of MODES) {
    await accepted(await postJson(ctx, query, records(9_996)), label);
    await refused(await postJson(ctx, query, records(9_997)), 'At most 10000 records per import', label);
  }
});

test('JSON imports count every parsed value, tag references included, and limit nesting to 32 levels', async () => {
  const ctx = await setup();
  const values = 'At most 250000 values per import';
  // The root, `format`, `version` and `extra` take four values.
  const padding = (length: number) => exportOf({ extra: Array.from({ length }, () => []) });
  const tagged = exportOf({
    tags: [{ id: 1, name: 'one' }],
    time_entries: [
      { id: 1, start: '2026-10-01T09:00:00Z', stop: '2026-10-01T10:00:00Z', tag_ids: Array(250_000).fill(1) },
    ],
  });
  const accounts = await importingAccounts(ctx);
  const before = await catalogCounts(ctx);
  for (const [label, query] of MODES) {
    const account = accounts[label];
    await accepted(await postJson(account, query, padding(249_996)), label);
    await refused(await postJson(account, query, padding(249_997)), values, label);
    await refused(await postJson(account, query, tagged), values, label);
    await accepted(await postJson(account, query, nested(32)), label);
    await refused(await postJson(account, query, nested(33)), 'At most 32 levels of nesting per import', label);
  }
  assert.deepEqual(await catalogCounts(ctx), before);
});

test('JSON limits and unsupported containers are refused before a transaction opens; only limits are marked', async () => {
  let transactions = 0;
  const imports = createImportOperations(
    {
      transaction: async () => {
        transactions++;
        throw new Error('A transaction opened');
      },
    },
    1,
    async () => {},
  );
  const refusal = async (file: string, message: string, limit: boolean) =>
    assert.rejects(imports.importJsonExport(JSON.parse(file), { dryRun: false }), error => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.kind, 'invalid');
      assert.equal(error.message, message);
      assert.equal(isImportLimit(error), limit);
      return true;
    });
  await refusal(exportOf({ time_entries: Array(10_001).fill(0) }), 'At most 10000 records per import', true);
  await refusal(nested(33), 'At most 32 levels of nesting per import', true);
  await refusal(exportOf({ tags: { 1: 'x' } }), 'Invalid export file: "tags" must be an array', false);
  await refusal(exportOf({ clients: 'x' }), 'Invalid export file: "clients" must be an array', false);
  assert.equal(transactions, 0);
});

test('CSV imports take 10,000 data rows, counting unselected users, and refuse one more or a dense file', async () => {
  const ctx = await setup();
  const header = 'User,Email,Description,Start date,Start time,Duration\n';
  const ann = 'Ann,ann@example.com,Ann,2026-01-05,08:00:00,00:10:00\n';
  const bob = 'Bob,bob@example.com,Bob,2026-01-05,09:00:00,00:10:00\n';
  const csv = (bobRows: number) => header + ann + bob.repeat(bobRows);
  const preview = await accepted(await postCsv(ctx, '?dry_run=true', csv(1)), 'users');
  const key = preview.users.find((user: any) => user.user === 'Ann').key as string;
  const dense = header + `Row,,,,${','.repeat(995)}\n`.repeat(250);
  const accounts = await importingAccounts(ctx);
  for (const [label, dryRun] of MODES) {
    const account = accounts[label];
    const query = `?user=${encodeURIComponent(key)}${dryRun.replace('?', '&')}`;
    const result = await accepted(await postCsv(account, query, csv(9_999)), label);
    assert.equal(result.skipped[0].rows, 9_999, label);
    await refused(await postCsv(account, query, csv(10_000)), 'At most 10000 rows per import', label);
    await refused(await postCsv(account, query, dense), 'At most 250000 cells per import', label);
  }
});

test('CSV imports count each tag name in a Tags cell, from every row, against the 250,000 cells', async () => {
  const ctx = await setup();
  const message = 'At most 250000 cells per import, counting each tag name';
  const header = 'User,Email,Description,Start date,Start time,Duration,Tags\n';
  const ann = 'Ann,ann@example.com,Ann,2026-01-05,08:00:00,00:10:00,\n';
  // Bob's rows are not imported, yet their tag names still count: the three rows hold 20 cells besides them.
  const csv = (names: number) =>
    header + ann + `Bob,bob@example.com,Bob,2026-01-05,09:00:00,00:10:00,"${Array(names).fill('x').join(',')}"\n`;
  const preview = await accepted(await postCsv(ctx, '?dry_run=true', csv(1)), 'users');
  const key = preview.users.find((user: any) => user.user === 'Ann').key as string;
  const accounts = await importingAccounts(ctx);
  const before = await catalogCounts(ctx);
  for (const [label, dryRun] of MODES) {
    const account = accounts[label];
    const query = `?user=${encodeURIComponent(key)}${dryRun.replace('?', '&')}`;
    assert.equal((await accepted(await postCsv(account, query, csv(249_980)), label)).created, 1, label);
    await refused(await postCsv(account, query, csv(249_981)), message, label);
  }
  // Only Ann's row was imported, without tags.
  assert.deepEqual(await catalogCounts(ctx), { ...before, time_entries: (before.time_entries ?? 0) + 1 });
});

test('a CSV Tags cell with 250,001 names is refused before a transaction opens', async () => {
  let transactions = 0;
  const imports = createImportOperations(
    {
      transaction: async () => {
        transactions++;
        throw new Error('A transaction opened');
      },
    },
    1,
    async () => {},
  );
  const csv = `Description,Start date,Start time,Duration,Tags\nx,2026-01-05,08:00:00,00:10:00,"${Array(250_001).fill('x').join(',')}"\n`;
  await assert.rejects(imports.importTogglCsv(csv, { dryRun: false }), error => {
    assert.ok(isImportLimit(error), String(error));
    assert.equal((error as Error).message, 'At most 250000 cells per import, counting each tag name');
    return true;
  });
  assert.equal(transactions, 0);
});
