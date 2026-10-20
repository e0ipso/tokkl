import { expect, test } from './admin-tests-helpers.ts';
import { login, loginAs } from './helpers.ts';
import { TimerApi, instant, madridWallClock } from './timer-tests-helpers.ts';

// The time resolution belongs to the whole server, so these scenarios run in the instance project.
// The `instance` fixture puts the settings back after each one. Before saving, the web app shows
// the duration the server will store; a running timer keeps real seconds until it stops.

const MINUTE = 60_000;

test('at a 15-minute resolution the timer bar previews and announces snapped durations', async ({ page, data, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 400, method: 'POST', path: /^\/api\/v9\/workspaces\/\d+\/time_entries$/, reason: 'the scenario adds an entry that rounds to zero' });
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });

  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Short call');
  await timer.getByLabel('Date').fill('2025-11-12');
  await timer.getByLabel('Start time').fill('9:00');
  // Both ends of 9:00 to 9:07 snap to 9:00, so the server refuses it.
  await timer.getByLabel('End time').fill('9:07');
  await expect(timer.locator('.manual-duration')).toHaveText('0:00:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Time entry is too short: it rounds to zero at the 15-minute time resolution')).toBeVisible();
  expect(await api.entries()).toEqual([]);
  // 9:08 is nearer 9:15 than 9:00.
  await timer.getByLabel('End time').fill('9:08');
  await expect(timer.locator('.manual-duration')).toHaveText('0:15:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 0:15:00')).toBeVisible();
  const manual = (await api.entries()).find((entry) => entry.description === 'Short call')!;
  expect([instant(manual.start), instant(manual.stop)]).toEqual([Date.parse('2025-11-12T08:00:00Z'), Date.parse('2025-11-12T08:15:00Z')]);

  // A duration typed into the idle timer saves an entry that ends now. Each end goes to its nearest
  // quarter hour, so 20 minutes store as 15 or 30 depending on the time of day.
  await timer.getByRole('button', { name: 'Timer mode' }).click();
  await timer.getByLabel('Description').fill('Typed duration');
  await timer.getByLabel('Duration').fill('20m');
  await timer.getByLabel('Duration').press('Enter');
  // The manual entry's toast can still be up, so look at the newest one.
  await expect(page.getByText(/^Added 0:(15|30):00$/).last()).toBeVisible();
  const typed = (await api.entries()).find((entry) => entry.description === 'Typed duration')!;
  expect([15 * MINUTE, 30 * MINUTE]).toContain(instant(typed.stop) - instant(typed.start));

  // The running timer and the tab title tick real seconds, not 0:15:00. Stopped seconds later, it
  // rounds to zero and goes to the trash.
  await timer.getByLabel('Description').fill('Ticking');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: /elapsed, edit start time$/ })).toHaveText(/^0:00:0[2-9]$/);
  await expect(page).toHaveTitle(/^0:00:0[2-9] · Ticking$/);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(page.getByText('Too short to keep, so the entry went to the trash')).toBeVisible();
  const [trashed] = await api.trash();
  expect(trashed!.description).toBe('Ticking');
  expect(instant(trashed!.start) % (15 * MINUTE)).toBe(0);
  expect(trashed!.stop).toBe(trashed!.start);
});

test('at a 15-minute resolution the entry editor previews snapped durations and split halves', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const start = Date.parse(`${day}T08:00:00Z`);
  const { id } = await data.createEntry({ description: 'Snapped edit', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z` });
  const clock = (offsetMinutes: number) => madridWallClock(new Date(start + offsetMinutes * MINUTE)).time;
  await login(page);
  const row = page.locator('.entry-line', { has: page.locator('input[value="Snapped edit"]') });
  const openEditor = async () => {
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    return page.getByRole('dialog', { name: 'Edit entry' });
  };

  let editor = await openEditor();
  const duration = editor.getByLabel('Duration');
  await expect(duration).toHaveValue('1:00:00');
  // A typed duration shows the length the server will store and moves the end by what was typed:
  // an end at 20 minutes is nearer 15 than 30.
  await duration.fill('20m');
  await duration.blur();
  await expect(duration).toHaveValue('0:15:00');
  await expect(editor.getByLabel('End')).toHaveValue(clock(20));
  // An end eight minutes past the hour moves to quarter past.
  await editor.getByLabel('End').fill(clock(68));
  await editor.getByLabel('End').blur();
  await expect(duration).toHaveValue('1:15:00');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const api = await TimerApi.open(page);
  const saved = (await api.entries()).find((entry) => entry.id === id)!;
  expect(instant(saved.stop) - instant(saved.start)).toBe(75 * MINUTE);

  editor = await openEditor();
  await expect(editor.getByLabel('Duration')).toHaveValue('1:15:00');
  const splitAt = editor.getByLabel('Split at');
  // A split time that snaps onto the entry's start or stop leaves nothing to split off.
  for (const offset of [5, 70]) {
    await splitAt.fill(clock(offset));
    await editor.getByRole('button', { name: 'Split' }).click();
    await expect(editor.getByText('The split time must fall inside the entry')).toBeVisible();
    await expect(editor.getByText(/^Splits into/)).toBeHidden();
  }
  expect((await api.entries()).filter((entry) => entry.description === 'Snapped edit')).toHaveLength(1);

  // A split at 37 minutes moves to the grid point at 30, which both halves share.
  await splitAt.fill(clock(37));
  await expect(editor.getByText('Splits into 0:30:00 and 0:45:00.')).toBeVisible();
  await editor.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Entry split in two')).toBeVisible();
  const halves = (await api.entries())
    .filter((entry) => entry.description === 'Snapped edit')
    .map((entry) => [instant(entry.start), instant(entry.stop)])
    .sort(([a], [b]) => a! - b!);
  expect(halves).toEqual([[start, start + 30 * MINUTE], [start + 30 * MINUTE, start + 75 * MINUTE]]);
});

test('across a half-hour clock change the stored start stays on the local hour grid', async ({ page, data, users }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 60 });
  // Lord Howe Island springs forward from 02:00 (UTC+10:30) to 02:30 (UTC+11) on 2026-10-04, so
  // local 02:30 is off the hour grid and the grid point nearest 01:50 is 03:00. 03:40 goes to 04:00.
  const user = await users.create({ timezone: 'Australia/Lord_Howe' });
  await loginAs(page, user.account);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });

  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Island call');
  await timer.getByLabel('Date').fill('2026-10-04');
  await timer.getByLabel('Start time').fill('1:50');
  await timer.getByLabel('End time').fill('3:40');
  await expect(timer.locator('.manual-duration')).toHaveText('1:00:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 1:00:00')).toBeVisible();
  const saved = (await api.entries()).find((entry) => entry.description === 'Island call')!;
  expect([instant(saved.start), instant(saved.stop)]).toEqual([Date.parse('2026-10-03T16:00:00Z'), Date.parse('2026-10-03T17:00:00Z')]);
  await expect(timer.getByLabel('Start time')).toHaveValue('04:00');
});

test('an entry saved under a finer resolution splits into halves that fill its snapped span', async ({ page, data }) => {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const start = Date.parse(`${day}T08:05:00Z`);
  // Stored at the default 5-minute resolution, then the server moves to 15: the entry now snaps to
  // 08:00-09:00, and each half carries its own snapped start and stop so they add up to that hour.
  await data.createEntry({ description: 'Older grid', start: `${day}T08:05:00Z`, stop: `${day}T09:05:00Z` });
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  await login(page);
  const row = page.locator('.entry-line', { has: page.locator('input[value="Older grid"]') });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });

  await editor.getByLabel('Split at').fill(madridWallClock(new Date(start + 25 * MINUTE)).time);
  await expect(editor.getByText('Splits into 0:30:00 and 0:30:00.')).toBeVisible();
  await editor.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Entry split in two')).toBeVisible();
  const api = await TimerApi.open(page);
  const halves = (await api.entries())
    .filter((entry) => entry.description === 'Older grid')
    .map((entry) => [instant(entry.start), instant(entry.stop)])
    .sort(([a], [b]) => a! - b!);
  const hour = start - 5 * MINUTE;
  expect(halves).toEqual([[hour, hour + 30 * MINUTE], [hour + 30 * MINUTE, hour + 60 * MINUTE]]);
});

test('across a half-hour clock change the entry editor splits on the local hour grid', async ({ page, data, users }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 60 });
  // On Lord Howe Island 01:00 (UTC+10:30) to 03:30 (UTC+11) on 2026-10-04 is two hours. The stop
  // ties between local 03:00 and 04:00 and goes to 04:00, so the entry stores two and a half hours.
  // Cut at 03:00, the halves last an hour and a half and an hour, and meet there.
  const user = await users.create({ timezone: 'Australia/Lord_Howe' });
  const { id } = await user.createEntry({ description: 'Island shift', start: '2026-10-03T14:30:00Z', stop: '2026-10-03T16:30:00Z' });
  await page.clock.setFixedTime(new Date('2026-10-04T01:00:00Z'));
  await loginAs(page, user.account);
  const api = await TimerApi.open(page);
  const stored = async () => (await api.entries())
    .map((entry) => [instant(entry.start), instant(entry.stop)])
    .sort(([a], [b]) => a! - b!);
  const [one, three, four] = ['2026-10-03T14:30:00Z', '2026-10-03T16:00:00Z', '2026-10-03T17:00:00Z'].map(Date.parse);
  expect(await stored()).toEqual([[one, four]]);

  const row = page.locator('.entry-line', { has: page.locator('input[value="Island shift"]') });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await editor.getByLabel('Split at').fill('3:00');
  await expect(editor.getByText('Splits into 1:30:00 and 1:00:00.')).toBeVisible();
  await editor.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Entry split in two')).toBeVisible();
  expect(await stored()).toEqual([[one, three], [three, four]]);
  expect((await api.entries()).map((entry) => entry.id)).toContain(id);
});
