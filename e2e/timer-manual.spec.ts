import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { TimerApi } from './timer-tests-helpers.ts';

// Manual mode persists per user (docs/PRD.md M1), an end before the start rolls to the next
// account-local day (M3), and each saved entry's stop becomes the next start (M5). The e2e
// account lives in Europe/Madrid.

interface Step {
  end: string;
  /** Duration preview before saving. */
  duration: string;
  /** Date and start fields after saving: the saved stop on its own local day. */
  next: { date: string; start: string };
  /** Saved instants. */
  saved: [string, string];
}

/** Adds one entry per step, each continuing from the previous stop, then checks the saved range. */
async function addSequence(page: Page, api: TimerApi, first: { date: string; start: string }, steps: Step[]) {
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Date').fill(first.date);
  await timer.getByLabel('Start time').fill(first.start);
  for (const [index, step] of steps.entries()) {
    const description = `${first.date} ${first.start} #${index + 1}`;
    await timer.getByLabel('Description').fill(description);
    await timer.getByLabel('End time').fill(step.end);
    await expect(timer.locator('.manual-duration')).toHaveText(step.duration);
    await timer.getByRole('button', { name: 'Add entry' }).click();
    await expect(timer.getByLabel('Date')).toHaveValue(step.next.date);
    await expect(timer.getByLabel('Start time')).toHaveValue(step.next.start);
    await expect(timer.getByLabel('End time')).toHaveValue('');
    await expect.poll(async () => {
      const saved = (await api.entries()).find((entry) => entry.description === description);
      return saved ? [Date.parse(saved.start), Date.parse(saved.stop!)] : null;
    }).toEqual(step.saved.map((iso) => Date.parse(iso)));
  }
}

/** After a reload, the saved entries still chain: each starts exactly where the previous one stopped. */
async function expectChained(page: Page, api: TimerApi, prefix: string, count: number) {
  await page.reload();
  await expect(page.getByRole('region', { name: 'Timer' }).getByLabel('Date')).toBeVisible();
  const entries = (await api.entries())
    .filter((entry) => entry.description.startsWith(prefix))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  expect(entries).toHaveLength(count);
  for (let i = 1; i < entries.length; i++) expect(Date.parse(entries[i]!.start)).toBe(Date.parse(entries[i - 1]!.stop!));
}

test('manual mode survives reload and a 24-hour overnight sequence chains on the right dates', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await expect(timer.getByLabel('Date')).toBeVisible();
  await expect.poll(async () => (await api.preferences()).manualMode).toBe(true);

  await page.reload();
  await expect(timer.getByLabel('Date')).toBeVisible();
  await expect(timer.getByRole('button', { name: 'Manual mode' })).toHaveClass(/active/);
  await expect(timer.getByRole('button', { name: 'Start timer' })).toHaveCount(0);

  // November is CET (UTC+1).
  await addSequence(page, api, { date: '2025-11-12', start: '22:00' }, [
    { end: '23:30', duration: '1:30:00', next: { date: '2025-11-12', start: '23:30' }, saved: ['2025-11-12T21:00:00Z', '2025-11-12T22:30:00Z'] },
    { end: '1:15', duration: '1:45:00', next: { date: '2025-11-13', start: '01:15' }, saved: ['2025-11-12T22:30:00Z', '2025-11-13T00:15:00Z'] },
    { end: '2', duration: '0:45:00', next: { date: '2025-11-13', start: '02:00' }, saved: ['2025-11-13T00:15:00Z', '2025-11-13T01:00:00Z'] },
  ]);
  await expectChained(page, api, '2025-11-12 22:00', 3);
  await expect(timer.getByRole('button', { name: 'Manual mode' })).toHaveClass(/active/);
});

test('a 24-hour sequence across the spring clock change keeps local times and real durations', async ({ page, data }) => {
  await data.savePreferences({ timeofday_format: 'H:mm' });
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  // 2026-03-29: 02:00 CET jumps to 03:00 CEST.
  await addSequence(page, api, { date: '2026-03-28', start: '23:00' }, [
    { end: '01:30', duration: '2:30:00', next: { date: '2026-03-29', start: '01:30' }, saved: ['2026-03-28T22:00:00Z', '2026-03-29T00:30:00Z'] },
    { end: '04:00', duration: '1:30:00', next: { date: '2026-03-29', start: '04:00' }, saved: ['2026-03-29T00:30:00Z', '2026-03-29T02:00:00Z'] },
  ]);
  await expectChained(page, api, '2026-03-28 23:00', 2);
});

test('a 12-hour sequence with explicit suffixes chains across both clock changes', async ({ page, data }) => {
  await data.savePreferences({ timeofday_format: 'h:mm A' });
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();

  // Spring: 11:30pm CET to 1:30am CET, then to 3:30am CEST, which is one real hour later.
  await addSequence(page, api, { date: '2026-03-28', start: '11:30pm' }, [
    { end: '1:30am', duration: '2:00:00', next: { date: '2026-03-29', start: '1:30 AM' }, saved: ['2026-03-28T22:30:00Z', '2026-03-29T00:30:00Z'] },
    { end: '3:30am', duration: '1:00:00', next: { date: '2026-03-29', start: '3:30 AM' }, saved: ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z'] },
  ]);
  await expectChained(page, api, '2026-03-28 11:30pm', 2);

  // Autumn: 2025-10-26 03:00 CEST falls back to 02:00 CET. A repeated 2:30am resolves to the
  // later, CET occurrence, and the next entry starts exactly there.
  await addSequence(page, api, { date: '2025-10-25', start: '11pm' }, [
    { end: '2:30am', duration: '4:30:00', next: { date: '2025-10-26', start: '2:30 AM' }, saved: ['2025-10-25T21:00:00Z', '2025-10-26T01:30:00Z'] },
    { end: '9am', duration: '6:30:00', next: { date: '2025-10-26', start: '9:00 AM' }, saved: ['2025-10-26T01:30:00Z', '2025-10-26T08:00:00Z'] },
  ]);
  await expectChained(page, api, '2025-10-25 11pm', 2);
});
