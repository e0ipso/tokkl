import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FAVORITES } from '../src/models/users.ts';
import { setup, type TestContext } from './helpers.ts';

const favorite = (description: string) => ({ description, project_id: null, task_id: null, tags: [], billable: false });

const POMODORO_DEFAULTS = {
  pomodoro_enabled: false,
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  pomodoro_long_break_interval_in_minutes: 15,
  pomodoro_long_break_every: 4,
  pomodoro_stop_timer_at_end: true,
};
const POMODORO_RANGES: Record<string, [min: number, max: number]> = {
  pomodoro_focus_interval_in_minutes: [1, 180],
  pomodoro_break_interval_in_minutes: [1, 60],
  pomodoro_long_break_interval_in_minutes: [1, 60],
  pomodoro_long_break_every: [1, 12],
};
const POMODORO_TOGGLES = ['pomodoro_enabled', 'pomodoro_stop_timer_at_end'] as const;

const storedPreferences = (ctx: TestContext) =>
  (ctx.db.prepare('SELECT preferences FROM users WHERE id = ?').get(ctx.user.id) as { preferences: string }).preferences;
const pomodoroOf = (prefs: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(POMODORO_DEFAULTS).map((key) => [key, prefs[key]]));

test('invalid known preferences are rejected with 400 and nothing is saved', async () => {
  const ctx = await setup();
  const saved = await ctx.json('POST', '/api/v9/me/preferences', { date_format: 'DD/MM/YYYY', favorites: [favorite('Standup')] });
  assert.equal(saved.status, 200);
  const before = (await ctx.json('GET', '/api/v9/me/preferences')).body;
  const storedBefore = storedPreferences(ctx);

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
    // Below, above, a fraction inside the range and a numeric string for every integer key.
    ...Object.entries(POMODORO_RANGES).flatMap(([key, [min, max]]) =>
      [min - 1, max + 1, min + 0.5, String(min)].map((value) => ({ [key]: value }))),
    { pomodoro_focus_interval_in_minutes: null },
    { pomodoro_focus_interval_in_minutes: true },
    ...POMODORO_TOGGLES.flatMap((key) => [{ [key]: 'true' }, { [key]: 1 }, { [key]: null }]),
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
  assert.equal(
    (await ctx.json('POST', '/api/v9/me/preferences', { pomodoro_long_break_every: 13 })).body,
    'Invalid pomodoro_long_break_every: expected an integer from 1 to 12',
  );
  assert.deepEqual((await ctx.json('GET', '/api/v9/me/preferences')).body, before);
  // Reads fall back to defaults, so only the stored record shows that nothing was written.
  assert.equal(storedPreferences(ctx), storedBefore);
});

test('a new account reads the Pomodoro defaults', async () => {
  const ctx = await setup();
  assert.deepEqual(pomodoroOf((await ctx.json('GET', '/api/v9/me/preferences')).body), POMODORO_DEFAULTS);
  assert.deepEqual(pomodoroOf(JSON.parse(storedPreferences(ctx))), POMODORO_DEFAULTS);
});

test('Pomodoro settings save and read back at the bounds of their ranges', async () => {
  const ctx = await setup();
  const values: Array<[string, unknown]> = [
    ...Object.entries(POMODORO_RANGES).flatMap(([key, [min, max]]): Array<[string, unknown]> => [[key, min], [key, max]]),
    // The value that differs from the default goes first, so reading back the second shows it replaced the first.
    ...POMODORO_TOGGLES.flatMap((key): Array<[string, unknown]> =>
      [!POMODORO_DEFAULTS[key], POMODORO_DEFAULTS[key]].map((value) => [key, value])),
  ];
  for (const [key, value] of values) {
    const saved = await ctx.json('POST', '/api/v9/me/preferences', { [key]: value });
    assert.equal(saved.status, 200, `${key}: ${value}`);
    assert.equal(saved.body[key], value, `${key}: ${value}`);
    assert.equal((await ctx.json('GET', '/api/v9/me/preferences')).body[key], value, `${key}: ${value}`);
  }

  // A client-specific save writes the account's record, which every client reads.
  assert.equal((await ctx.json('POST', '/api/v9/me/preferences/android', { pomodoro_long_break_every: 6 })).status, 200);
  assert.equal((await ctx.json('GET', '/api/v9/me/preferences')).body.pomodoro_long_break_every, 6);
  assert.equal((await ctx.json('GET', '/api/v9/me/preferences/web')).body.pomodoro_long_break_every, 6);
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
    pomodoro_enabled: 'yes', pomodoro_focus_interval_in_minutes: 0, pomodoro_break_interval_in_minutes: 61,
    pomodoro_long_break_interval_in_minutes: 7.5, pomodoro_long_break_every: '4', pomodoro_stop_timer_at_end: null,
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
  assert.deepEqual(pomodoroOf(prefs), POMODORO_DEFAULTS);
});
