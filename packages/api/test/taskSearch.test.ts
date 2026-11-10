import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageFor } from './fixtures/database.ts';
import { corruptRecord } from './fixtures/physical.ts';
import { setup, type TestContext } from './helpers.ts';
import { createCatalogQueries, type TaskSearch } from '../src/domain/queries.ts';
import { GOLDEN, NAMES } from './fixtures/taskSearchGolden.ts';
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

test('the workspace task search answers its golden pages', async () => {
  const ctx = await setup();
  const projects = await seed(ctx);
  const ws = (await storageFor(ctx.db).workspaces.get(ctx.wid))!;
  for (const [{ project, ...search }, window, names, total] of GOLDEN) {
    const query: TaskSearch = { ...search, projectId: project === undefined ? undefined : projects[project] };
    const actual = await storageFor(ctx.db).readSnapshot(r => createCatalogQueries(r).searchTasks(ws, query, window));
    assert.deepEqual([actual.tasks.map(task => task.name), actual.totalCount], [names, total], JSON.stringify(query));
  }
});

test('the paged task envelope over HTTP carries the same page', async () => {
  const ctx = await setup();
  await seed(ctx);
  const ws = (await storageFor(ctx.db).workspaces.get(ctx.wid))!;
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
    const query: TaskSearch = { search, sortField, sortOrder: 'DESC' };
    const expected = await storageFor(ctx.db).readSnapshot(r =>
      createCatalogQueries(r).searchTasks(ws, query, { page: 2, perPage: 4 }),
    );
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
