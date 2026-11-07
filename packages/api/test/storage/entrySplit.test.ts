import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { splitTimeEntry } from '../../src/domain/timeEntries.ts';
import { createTimerPublication } from '../../src/services/timerPublication.ts';
import { errorReply } from '../../src/http/errors.ts';
import { createTimeEntry } from '../fixtures/entryBodies.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryAccount, entryAt, entryTimerFactory } from './support/entry-timer.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: a split writes both halves in one transaction or neither`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    t.after(() => fixture.cleanup());
    const connection = await initializeDatabase(fixture.config);
    t.after(() => connection.close());
    let failEdit = false;
    const runner = createTransactionRunner(connection, db => {
      const repositories = entryTimerFactory(backend)(db);
      const { entries } = repositories;
      // Fails the edit of the first half, which runs after the second half was created.
      const update: typeof entries.update = (...args) =>
        failEdit ? Promise.reject(new Error('edit failed')) : entries.update(...args);
      return { ...repositories, entries: { ...entries, update } };
    });
    const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('split')));
    const wid = user.defaultWorkspaceId;
    const publish = createTimerPublication(async () => {});
    const original = await runner.transaction(ctx =>
      createTimeEntry(
        ctx,
        user,
        wid,
        {
          description: 'Pairing',
          start: entryAt('08:00:00').toISOString(),
          stop: entryAt('10:00:00').toISOString(),
          tags: ['b', 'a'],
          billable: true,
        },
        publish,
      ),
    );
    const live = () => runner.readSnapshot(ctx => ctx.entries.list(user.id));
    const split = (at: string) =>
      runner.transaction(ctx => splitTimeEntry(ctx, user, original.id, { at: entryAt(at) }, publish));

    failEdit = true;
    await assert.rejects(split('09:00:00'), /edit failed/);
    failEdit = false;
    const untouched = await live();
    assert.equal(untouched.length, 1);
    assert.equal(untouched[0]!.start, original.start);
    assert.equal(untouched[0]!.stop, original.stop);

    // Two splits at one instant race for the user's guard: the second finds the cut at its stop.
    const results = await Promise.allSettled([split('09:00:00'), split('09:00:00')]);
    const done = results.filter(result => result.status === 'fulfilled');
    const refused = results.filter(result => result.status === 'rejected');
    assert.equal(done.length, 1);
    assert.deepEqual(errorReply(refused[0]!.reason), {
      status: 400,
      headers: {},
      body: 'The split time must fall inside the entry',
    });
    const { first, second } = done[0]!.value;
    assert.equal(first.id, original.id);
    assert.deepEqual([first.start, first.stop], [original.start, entryAt('09:00:00').toISOString()]);
    assert.deepEqual([second.start, second.stop], [entryAt('09:00:00').toISOString(), original.stop]);
    for (const half of [first, second]) {
      assert.equal(half.description, 'Pairing');
      assert.equal(half.billable, true);
      assert.deepEqual(
        half.tags.map(tag => tag.name),
        original.tags.map(tag => tag.name),
      );
    }
    assert.equal((await live()).length, 2);
  });
}
