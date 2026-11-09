import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageFor } from './fixtures/database.ts';
import { corruptRecord } from './fixtures/physical.ts';
import { setup, type TestContext } from './helpers.ts';
import { createCatalogQueries, type TaskSearch } from '../src/domain/queries.ts';
import type { TaskSummary } from '../src/domain/model.ts';
import { NAMES, oracle, SEARCHES } from './fixtures/taskSearchOracle.ts';
import { serializeTask } from '../src/presenters/toggl.ts';

async function seed(ctx: TestContext) {
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const projects: number[] = [];
  for (const name of ['One', 'Two', 'Three']) {
    const reply = await ctx.json('POST', `${ws}/projects`, { name });
    assert.equal(reply.status, 200);
    projects.push(reply.body.id);
  }
  for (const [index, name] of NAMES.entries()) {
    // Names differing only in ASCII case need projects of their own.
    const pid = projects[index % 3]!;
    const reply = await ctx.json('POST', `${ws}/projects/${pid}/tasks`, { name, active: index % 3 !== 0 });
    assert.equal(reply.status, 200, `${name}: ${JSON.stringify(reply.body)}`);
    // Creation instants with ties, and update instants either side of the `since` used below.
    await corruptRecord(
      ctx.db,
      'tasks',
      {
        created_at: `2026-10-0${(index % 4) + 1}T09:00:00.000Z`,
        updated_at: `2026-10-${10 + (index % 5)}T09:00:00.000Z`,
      },
      { id: reply.body.id },
    );
  }
  return projects;
}

test('the workspace task search answers exactly what the in-memory search answered', async () => {
  const ctx = await setup();
  const projects = await seed(ctx);
  const ws = (await storageFor(ctx.db).workspaces.get(ctx.wid))!;
  const read = <T>(work: (queries: ReturnType<typeof createCatalogQueries>) => Promise<T>) =>
    storageFor(ctx.db).readSnapshot(r => work(createCatalogQueries(r)));
  const all = await read(queries => queries.workspaceTasks(ws));
  assert.equal(all.length, NAMES.length);
  const body = (tasks: TaskSummary[]) => JSON.stringify(tasks.map(serializeTask));

  let compared = 0;
  for (const sortField of ['name', 'created_at'] as const)
    for (const sortOrder of ['ASC', 'DESC'] as const)
      for (const search of SEARCHES)
        for (const active of [undefined, true, false])
          for (const projectId of [undefined, projects[1]!])
            for (const changedSince of [undefined, '2026-10-12T09:00:00.000Z']) {
              const query: TaskSearch = { projectId, active, changedSince, search, sortField, sortOrder };
              for (const window of [
                { page: 1, perPage: 200 },
                { page: 2, perPage: 3 },
                { page: 1.5, perPage: 2.5 },
                { page: 9, perPage: 3 },
              ]) {
                const expected = oracle(all, query, window);
                const actual = await read(queries => queries.searchTasks(ws, query, window));
                const label = JSON.stringify({ query, window });
                assert.equal(actual.totalCount, expected.totalCount, label);
                assert.equal(body(actual.tasks), body(expected.tasks), label);
                compared++;
              }
            }
  assert.ok(compared > 1000);
});

test('the paged task envelope over HTTP carries the same page', async () => {
  const ctx = await setup();
  await seed(ctx);
  const ws = (await storageFor(ctx.db).workspaces.get(ctx.wid))!;
  const all = await storageFor(ctx.db).readSnapshot(r => createCatalogQueries(r).workspaceTasks(ws));
  for (const [sortField, search] of [
    ['created_at', undefined],
    ['name', 'A'],
  ] as const) {
    const params = new URLSearchParams({
      active: 'both',
      sort_field: sortField,
      sort_order: 'desc',
      page: '2',
      per_page: '4',
    });
    if (search) params.set('search', search);
    const reply = await ctx.json('GET', `/api/v9/workspaces/${ctx.wid}/tasks?${params}`);
    assert.equal(reply.status, 200);
    const expected = oracle(all, { search, sortField, sortOrder: 'DESC' }, { page: 2, perPage: 4 });
    assert.deepEqual(reply.body, {
      data: JSON.parse(JSON.stringify(expected.tasks.map(serializeTask))),
      page: 2,
      per_page: 4,
      sort_field: sortField,
      sort_order: 'DESC',
      total_count: expected.totalCount,
    });
  }
});
