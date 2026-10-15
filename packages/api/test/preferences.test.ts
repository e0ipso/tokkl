import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FAVORITES } from '../src/models/users.ts';
import { setup } from './helpers.ts';

const favorite = (description: string) => ({ description, project_id: null, task_id: null, tags: [], billable: false });

test('invalid known preferences are rejected with 400 and nothing is saved', async () => {
  const ctx = await setup();
  const saved = await ctx.json('POST', '/api/v9/me/preferences', { date_format: 'DD/MM/YYYY', favorites: [favorite('Standup')] });
  assert.equal(saved.status, 200);
  const before = (await ctx.json('GET', '/api/v9/me/preferences')).body;

  const invalid: Array<Record<string, unknown>> = [
    { favorites: {} },
    { date_format: 42 },
    { timeofday_format: 7 },
    { date_format: '   ' },
    { favorites: Array.from({ length: MAX_FAVORITES + 1 }, (_, i) => favorite(`F${i}`)) },
    { favorites: [{ description: 'No tags', project_id: null, task_id: null, billable: false }] },
    { favorites: [{ ...favorite('Bad project'), project_id: -1 }] },
    { theme: 'neon' },
    { duration_format: 'hours' },
    { timerView: 'grid' },
    { manualMode: 'yes' },
    { collapseTimeEntries: 1 },
    // A valid change next to an invalid one must not be saved either.
    { theme: 'dark', favorites: {} },
  ];
  for (const body of invalid) {
    const response = await ctx.json('POST', '/api/v9/me/preferences', body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(
    (await ctx.json('POST', '/api/v9/me/preferences', { date_format: 42 })).body,
    'Invalid date_format: expected a non-empty string of at most 255 characters',
  );
  assert.deepEqual((await ctx.json('GET', '/api/v9/me/preferences')).body, before);
});

test('unknown keys and custom formats are preserved across saves', async () => {
  const ctx = await setup();
  const favorites = Array.from({ length: MAX_FAVORITES }, (_, i) => favorite(`F${i}`));
  const saved = await ctx.json('POST', '/api/v9/me/preferences/web', {
    date_format: 'ddd D MMM', timeofday_format: 'h:mm a', theme: 'dark', timerView: 'calendar',
    showTimeInTitle: true, favorites, client_widget: { nested: [1, 2] },
  });
  assert.equal(saved.status, 200);

  assert.equal((await ctx.json('POST', '/api/v9/me/preferences', { theme: 'light' })).status, 200);
  const prefs = (await ctx.json('GET', '/api/v9/me/preferences')).body;
  assert.equal(prefs.date_format, 'ddd D MMM');
  assert.equal(prefs.timeofday_format, 'h:mm a');
  assert.equal(prefs.theme, 'light');
  assert.equal(prefs.timerView, 'calendar');
  assert.equal(prefs.showTimeInTitle, true);
  assert.deepEqual(prefs.favorites, favorites);
  assert.deepEqual(prefs.client_widget, { nested: [1, 2] });
});

test('invalid values stored before validation read back as defaults', async () => {
  const ctx = await setup();
  ctx.db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify({
    date_format: 7, timeofday_format: '', theme: 'neon', duration_format: 'hours', manualMode: 'yes',
    favorites: {}, timerView: 'grid', legacy_key: 'kept',
  }), ctx.user.id);

  const prefs = (await ctx.json('GET', '/api/v9/me/preferences')).body;
  assert.equal(prefs.date_format, 'YYYY-MM-DD');
  assert.equal(prefs.timeofday_format, 'H:mm');
  assert.equal(prefs.theme, 'system');
  assert.equal(prefs.duration_format, 'improved');
  assert.equal(prefs.manualMode, false);
  assert.equal('favorites' in prefs, false);
  assert.equal('timerView' in prefs, false);
  assert.equal(prefs.legacy_key, 'kept');
});
