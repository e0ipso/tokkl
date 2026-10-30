import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from './fixtures/database.ts';
import { settleTimer } from './fixtures/domain.ts';
import { createTimeEntry, stopTimeEntry } from './fixtures/domain.ts';
import { addWorkspaceMember } from './fixtures/domain.ts';
import { subscribeTimer } from './fixtures/domain.ts';
import { addUser, iso, setup, type TestContext } from './helpers.ts';

/** An instant on the day these tests track time on. */
const at = (time: string) => `2026-10-14T${time}Z`;

const entriesUrl = (wid: number) => `/api/v9/workspaces/${wid}/time_entries`;

async function setResolution(ctx: TestContext, minutes: number): Promise<void> {
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: minutes })).status, 200);
}

/** Starts a timer through v9 in workspace `wid` and returns its entry id. */
async function startTimer(ctx: TestContext, body: Record<string, unknown> = {}, wid = ctx.wid): Promise<number> {
  const response = await ctx.json('POST', entriesUrl(wid), { start: at('09:00:00'), duration: -1, created_with: 'test', ...body });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.id;
}

function row(ctx: TestContext, table: string): Record<string, unknown> | undefined {
  const found = ctx.db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).get(ctx.user.id);
  return found && { ...found };
}

const session = (ctx: TestContext) => row(ctx, 'pomodoro_sessions');
const chain = (ctx: TestContext) => row(ctx, 'pause_chains');
const revision = (ctx: TestContext) => (row(ctx, 'timer_states')?.revision as number | undefined) ?? 0;

function discardOf(ctx: TestContext) {
  const { discarded_entry_id, discarded_start, discarded_stop } = row(ctx, 'timer_states')!;
  return { discarded_entry_id, discarded_start, discarded_stop };
}

/** Puts a work phase on the running entry `entryId` and settles, so the stored state holds the session. */
async function putSession(ctx: TestContext, entryId: number): Promise<void> {
  ctx.db.prepare(`
    INSERT INTO pomodoro_sessions (user_id, entry_id, work_minutes, short_rest_minutes, long_rest_minutes, long_rest_every,
      phase_kind, phase_start, completed)
    VALUES (?, ?, 25, 5, 15, 4, 'work', ?, 0)
  `).run(ctx.user.id, entryId, iso(at('09:00:00')));
  (await settleTimer(ctx.db, ctx.user.id));
  assert.ok(session(ctx), 'a session on the running entry stays');
}

interface ChainFields {
  project_id?: number;
  task_id?: number;
  tag_ids?: number[];
}

/** Puts a pause chain on the user and settles. `cloneEntryId` is the running clone, or null while paused. */
async function putChain(ctx: TestContext, cloneEntryId: number | null, fields: ChainFields = {}): Promise<void> {
  ctx.db.prepare(`
    INSERT INTO pause_chains (user_id, workspace_id, project_id, task_id, description, tag_ids_json, billable, seconds,
      clone_entry_id)
    VALUES (?, ?, ?, ?, 'Paused work', ?, 0, 600, ?)
  `).run(ctx.user.id, ctx.wid, fields.project_id ?? null, fields.task_id ?? null, JSON.stringify(fields.tag_ids ?? []),
    cloneEntryId);
  (await settleTimer(ctx.db, ctx.user.id));
  assert.ok(chain(ctx), 'a paused chain with nothing running, or one whose clone runs, stays');
}

interface Publish {
  revision: number;
  inTransaction: boolean;
}

/** Records every publish for the user: the revision the listener reads, and whether a transaction was still open. */
function watch(ctx: TestContext): Publish[] {
  const seen: Publish[] = [];
  subscribeTimer(ctx.db, ctx.user.id, () => seen.push({ revision: revision(ctx), inTransaction: ctx.db.isTransaction }));
  return seen;
}

test('each write that stops or removes the pomodoro entry ends the session and publishes once', async () => {
  const ctx = (await setup());
  const bob = (await addUser(ctx, { email: 'bob@example.com', role: 'user' }));
  (await addWorkspaceMember(ctx.db, ctx.wid, bob.user.id, 'member'));
  const url = entriesUrl(ctx.wid);
  const project = (await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Alpha' })).body.id as number;
  const heard = new Map([[ctx, watch(ctx)], [bob, watch(bob)]]);

  type End = (entryId: number, hour: string) => Promise<{ status: number }>;
  const ends: Array<[string, TestContext, End]> = [
    ['a v9 stop', ctx, (id, hour) => ctx.json('PATCH', `${url}/${id}/stop`, { stop: at(`${hour}:25:00`) })],
    ['a v9 delete', ctx, (id) => ctx.json('DELETE', `${url}/${id}`)],
    ['an edit that adds a stop', ctx, (id, hour) => ctx.json('PUT', `${url}/${id}`, { stop: at(`${hour}:25:00`) })],
    ['a bulk PATCH stop', ctx, (id, hour) =>
      ctx.json('PATCH', `${url}/${id}`, [{ op: 'replace', path: '/stop', value: at(`${hour}:25:00`) }])],
    ['a new start', ctx, (id, hour) => ctx.json('POST', url, { start: at(`${hour}:25:00`), duration: -1 })],
    // Bob tracks time in the admin's workspace, so the admin's project delete ends Bob's session.
    ['a project delete with its entries', bob, () =>
      ctx.json('DELETE', `/api/v9/workspaces/${ctx.wid}/projects/${project}?teDeletionMode=delete`)],
  ];
  for (const [index, [label, owner, end]] of ends.entries()) {
    const hour = String(9 + index).padStart(2, '0');
    const entryId = (await startTimer(owner, { start: at(`${hour}:00:00`), project_id: project }, ctx.wid));
    (await putSession(owner, entryId));
    const before = revision(owner);
    for (const seen of heard.values()) seen.splice(0);

    const response = await end(entryId, hour);
    assert.equal(response.status, 200, label);
    assert.equal(session(owner), undefined, label);
    assert.deepEqual(heard.get(owner), [{ revision: before + 1, inTransaction: false }], label);
    const other = owner === ctx ? bob : ctx;
    assert.deepEqual(heard.get(other), [], `${label}: the other account's state did not change`);
  }

  // A purge never reaches a running entry. It ends a session only when an earlier write left the
  // session on an entry already in the trash; the raw UPDATE stands in for that write.
  const stale = (await startTimer(ctx, { start: at('16:00:00') }));
  (await putSession(ctx, stale));
  ctx.db.prepare('UPDATE time_entries SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), stale);
  const before = revision(ctx);
  heard.get(ctx)!.splice(0);
  assert.equal((await ctx.json('DELETE', '/api/app/trash')).status, 200);
  assert.equal(session(ctx), undefined);
  assert.deepEqual(heard.get(ctx), [{ revision: before + 1, inTransaction: false }]);
});

test('a pomodoro that a stop rounds to zero is the discarded pomodoro until the next change', async () => {
  const ctx = (await setup());
  (await setResolution(ctx, 1));
  const url = entriesUrl(ctx.wid);
  const older = (await ctx.json('POST', url, { start: at('08:00:00'), stop: at('08:30:00') })).body.id as number;
  const entryId = (await startTimer(ctx, { start: at('09:00:10') }));
  (await putSession(ctx, entryId));
  const published = watch(ctx);
  const before = revision(ctx);

  const stopped = await ctx.json('PATCH', `${url}/${entryId}/stop`, { stop: at('09:00:20') });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.duration, 0);
  assert.ok(stopped.body.server_deleted_at);
  assert.equal(session(ctx), undefined);
  const discarded = { discarded_entry_id: entryId, discarded_start: iso(at('09:00:00')), discarded_stop: iso(at('09:00:00')) };
  assert.deepEqual(discardOf(ctx), discarded);
  assert.deepEqual(published, [{ revision: before + 1, inTransaction: false }]);

  // A write that changes nothing in the timer state keeps it.
  assert.equal((await ctx.json('PUT', `${url}/${older}`, { description: 'renamed' })).status, 200);
  assert.deepEqual(discardOf(ctx), discarded);

  // The next change that discards nothing clears it.
  (await startTimer(ctx, { start: at('10:00:00') }));
  assert.deepEqual(discardOf(ctx), { discarded_entry_id: null, discarded_start: null, discarded_stop: null });
  assert.equal(published.length, 2);

  // A session that moves on to a new pomodoro, as rest to work does, records the one it left in the trash.
  const left = (await startTimer(ctx, { start: at('11:00:10') }));
  (await putSession(ctx, left));
  const next = (await transaction(ctx.db, async operation => {
    (await stopTimeEntry(ctx.db, ctx.user, ctx.wid, left, at('11:00:20')));
    const created = (await createTimeEntry(ctx.db, ctx.user, ctx.wid, { start: at('11:00:20'), duration: -1 }));
    await operation.timers.saveSession({... (await operation.timers.getSession(ctx.user.id))!,entryId:created.id});
    return created.id;
  }));
  assert.equal(session(ctx)?.entry_id, next);
  assert.deepEqual(discardOf(ctx), {
    discarded_entry_id: left, discarded_start: iso(at('11:00:00')), discarded_stop: iso(at('11:00:00')),
  });
});

test('writes that leave the pomodoro entry running keep the session', async () => {
  const ctx = (await setup());
  const url = entriesUrl(ctx.wid);
  const older = (await ctx.json('POST', url, { start: at('08:00:00'), stop: at('08:30:00') })).body.id as number;
  const entryId = (await startTimer(ctx));
  (await putSession(ctx, entryId));
  const stored = session(ctx);
  const published = watch(ctx);
  const before = revision(ctx);

  // An edit to an older, stopped entry changes nothing the timer state holds.
  assert.equal((await ctx.json('PUT', `${url}/${older}`, { description: 'renamed' })).status, 200);
  assert.equal(revision(ctx), before);
  assert.deepEqual(published, []);

  // A start refused with 400 rolls back whole, so the pomodoro entry still runs and nothing is published.
  const refused = await ctx.json('POST', url, { start: at('09:10:00'), duration: -1, created_with: 'x'.repeat(256) });
  assert.equal(refused.status, 400);
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body.id, entryId);
  assert.deepEqual(session(ctx), stored);
  assert.equal(revision(ctx), before);
  assert.deepEqual(published, []);

  // Moving the open pomodoro's start keeps the session and its phase start. The running entry
  // changed, so the state gets a new revision.
  const moved = await ctx.json('PUT', `${url}/${entryId}`, { start: at('08:55:00') });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.stop, null);
  assert.equal(moved.body.start, '2026-10-14T08:55:00+00:00');
  assert.deepEqual(session(ctx), stored);
  assert.deepEqual(published, [{ revision: before + 1, inTransaction: false }]);
});

test('a paused chain ends when any other entry starts, and a resumed chain ends when its clone stops', async () => {
  const ctx = (await setup());
  const url = entriesUrl(ctx.wid);
  const published = watch(ctx);
  /** Puts a chain on the user and returns the revision one more change will raise by one. */
  const chainUp = async (clone: number | null) => {
    (await putChain(ctx, clone));
    published.splice(0);
    return revision(ctx);
  };
  const assertEnded = (label: string, before: number) => {
    assert.equal(chain(ctx), undefined, label);
    assert.deepEqual(published, [{ revision: before + 1, inTransaction: false }], label);
  };
  const stopCurrent = async () => {
    const current = (await ctx.json('GET', '/api/v9/me/time_entries/current')).body;
    assert.equal((await ctx.json('PATCH', `${url}/${current.id}/stop`)).status, 200);
  };
  // An entry deleted while it ran, for the undo below.
  const deleted = (await startTimer(ctx, { start: at('07:00:00') }));
  assert.equal((await ctx.json('DELETE', `${url}/${deleted}`)).status, 200);

  let before = (await chainUp(null));
  assert.equal((await ctx.json('POST', url, { start: at('10:00:00'), duration: -1 })).status, 200);
  assertEnded('a v9 start', before);

  (await stopCurrent());
  before = (await chainUp(null));
  const restore = await ctx.json('POST', '/api/app/import/json', {
    format: 'tokkl-export',
    time_entries: [
      { id: 1, start: at('08:00:00'), stop: at('08:30:00'), description: 'Restored and stopped' },
      { id: 2, start: at('11:00:00'), stop: null, description: 'Restored and running' },
    ],
  });
  assert.equal(restore.status, 200);
  assert.equal(restore.body.time_entries, 2);
  assertEnded('a JSON restore with a running entry', before);

  (await stopCurrent());
  before = (await chainUp(null));
  assert.equal((await ctx.json('POST', `/api/app/time_entries/${deleted}/restore`)).status, 200);
  assertEnded('undoing the delete of a running entry', before);

  // The restored entry now runs. As the clone of a resumed chain it keeps the chain until it stops.
  before = (await chainUp(deleted));
  assert.equal((await ctx.json('PATCH', `${url}/${deleted}/stop`)).status, 200);
  assertEnded('a v9 stop of the clone', before);
});

test('deleting the task, tag or project of running entries publishes to each user whose timer changed', async () => {
  const ctx = (await setup());
  const bob = (await addUser(ctx, { email: 'bob@example.com', role: 'user' }));
  (await addWorkspaceMember(ctx.db, ctx.wid, bob.user.id, 'member'));
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const project = (await ctx.json('POST', `${ws}/projects`, { name: 'Alpha' })).body.id as number;
  const task = (await ctx.json('POST', `${ws}/projects/${project}/tasks`, { name: 'Build' })).body.id as number;
  const tag = (await ctx.json('POST', `${ws}/tags`, { name: 'deep' })).body.id as number;
  const fields = { project_id: project, task_id: task, tag_ids: [tag] };
  // Bob tracks time in the admin's workspace. The admin runs the clone of a resumed pause chain.
  (await startTimer(bob, fields, ctx.wid));
  const clone = (await startTimer(ctx, fields));
  (await putChain(ctx, clone, fields));
  const heard = [watch(ctx), watch(bob)];
  const running = async (who: TestContext) => (await who.json('GET', '/api/v9/me/time_entries/current')).body;
  const assertHeardOnce = (label: string) =>
    assert.deepEqual(heard.map((seen) => seen.splice(0).length), [1, 1], label);

  assert.equal((await ctx.json('DELETE', `${ws}/projects/${project}/tasks/${task}`)).status, 200);
  for (const who of [ctx, bob]) assert.equal((await running(who)).task_id, null);
  assert.equal(chain(ctx)?.task_id, null);
  assertHeardOnce('task delete');

  assert.equal((await ctx.json('DELETE', `${ws}/tags/${tag}`)).status, 200);
  for (const who of [ctx, bob]) assert.deepEqual((await running(who)).tag_ids, []);
  assertHeardOnce('tag delete');

  assert.equal((await ctx.json('DELETE', `${ws}/projects/${project}`)).status, 200);
  for (const who of [ctx, bob]) assert.equal((await running(who)).project_id, null);
  assert.equal(chain(ctx)?.project_id, null);
  assert.equal(chain(ctx)?.clone_entry_id, clone);
  assertHeardOnce('project delete that keeps the entries');
});

test('renaming the project, client, task or tag a timer shows publishes the new name to each user', async () => {
  const ctx = (await setup());
  const bob = (await addUser(ctx, { email: 'bob@example.com', role: 'user' }));
  (await addWorkspaceMember(ctx.db, ctx.wid, bob.user.id, 'member'));
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const client = (await ctx.json('POST', `${ws}/clients`, { name: 'Acme' })).body.id as number;
  const project = (await ctx.json('POST', `${ws}/projects`, { name: 'Alpha', client_id: client })).body.id as number;
  const task = (await ctx.json('POST', `${ws}/projects/${project}/tasks`, { name: 'Build' })).body.id as number;
  const tag = (await ctx.json('POST', `${ws}/tags`, { name: 'deep' })).body.id as number;
  // Bob runs an entry in the admin's workspace. The admin is paused, with the tag on the chain.
  (await startTimer(bob, { project_id: project, task_id: task, tag_ids: [tag] }, ctx.wid));
  (await putChain(ctx, null, { tag_ids: [tag] }));
  const heard = [watch(ctx), watch(bob)];
  const state = async (who: TestContext) => (await who.json('GET', '/api/app/timer')).body;

  const renames: Array<[string, string, string, (bobs: any, admins: any) => void]> = [
    ['client', `${ws}/clients/${client}`, 'Acme Ltd', (bobs) => assert.equal(bobs.running_entry.client_name, 'Acme Ltd')],
    ['project', `${ws}/projects/${project}`, 'Beta', (bobs) => assert.equal(bobs.running_entry.project_name, 'Beta')],
    ['task', `${ws}/projects/${project}/tasks/${task}`, 'Ship', (bobs) => assert.equal(bobs.running_entry.task_name, 'Ship')],
    ['tag', `${ws}/tags/${tag}`, 'focus', (bobs, admins) => {
      assert.deepEqual(bobs.running_entry.tags, ['focus']);
      assert.deepEqual(admins.pause.tags, ['focus']);
    }],
  ];
  for (const [label, url, name, check] of renames) {
    assert.equal((await ctx.json('PUT', url, { name })).status, 200, label);
    // The tag is the only name the admin's paused chain shows.
    assert.deepEqual(heard.map((seen) => seen.splice(0).length), [label === 'tag' ? 1 : 0, 1], `${label} rename`);
    check((await state(bob)), (await state(ctx)));
  }
  // A rename that shows nothing new moves no revision.
  assert.equal((await ctx.json('PUT', `${ws}/tags/${tag}`, { name: 'focus' })).status, 200);
  assert.deepEqual(heard.map((seen) => seen.splice(0).length), [0, 0], 'a rename to the same name');
});

test('a listener that throws is logged and the write stands; one that settles again finds nothing new', async (t) => {
  const ctx = (await setup());
  const errors = t.mock.method(console, 'error', () => {});
  const settledAgain: boolean[] = [];
  const unsubscribe = [
    subscribeTimer(ctx.db, ctx.user.id, () => {
      throw new Error('listener failed');
    }),
    // A stream that reads fresh state on each publish settles inside its own transaction.
    subscribeTimer(ctx.db, ctx.user.id, async () => settledAgain.push((await settleTimer(ctx.db, ctx.user.id)))),
  ];
  const published = watch(ctx);

  const entryId = (await startTimer(ctx));
  assert.deepEqual(published, [{ revision: 1, inTransaction: false }]);
  assert.deepEqual(settledAgain, [false]);
  assert.equal(errors.mock.callCount(), 1);

  for (const stop of unsubscribe) stop();
  assert.equal((await ctx.json('PATCH', `${entriesUrl(ctx.wid)}/${entryId}/stop`)).status, 200);
  assert.deepEqual(published, [{ revision: 1, inTransaction: false }, { revision: 2, inTransaction: false }]);
  assert.deepEqual(settledAgain, [false]);
  assert.equal(errors.mock.callCount(), 1);
});

test('deleting an account deletes its session, pause chain and timer state', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const entryId = (await startTimer(bob));
  // One row in each table; whether the combination makes sense does not matter here.
  (await putSession(bob, entryId));
  (await putChain(bob, entryId));
  const tables = ['pomodoro_sessions', 'pause_chains', 'timer_states'];
  const counts = () => tables.map((table) =>
    (admin.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(bob.user.id) as { n: number }).n);
  assert.deepEqual(counts(), [1, 1, 1]);

  const response = await admin.json('DELETE', `/api/app/admin/users/${bob.user.id}`, { email: bob.user.email });
  assert.equal(response.status, 200);
  assert.deepEqual(counts(), [0, 0, 0]);
});
