import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { expectBrowserTimeZone, openCalendar, px, todayBlock } from './history-calendar-tests-helpers.ts';

// The account is in Europe/Madrid (e2e/fixtures.ts) and the browser in Tokyo, seven hours ahead,
// so midnight, "today" and the Monday week start fall at different instants for the two.
test.use({ timezoneId: 'Asia/Tokyo' });

/** The entry list's group for one day, found by its heading ("Today", "Sat, 13 Jun", ...). */
function dayGroup(page: Page, heading: string) {
  return page.locator('.day-group').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
}

/** Descriptions in a day group, in display order. */
async function descriptions(page: Page, heading: string): Promise<string[]> {
  return dayGroup(page, heading).getByLabel('Description').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
}

function summaryTotal(page: Page, label: 'Today' | 'This week') {
  return page.locator('.timer-summary span', { hasText: label }).locator('strong');
}

function calendarDayTotal(page: Page, label: string) {
  return page.locator('.calendar-day-head').filter({ has: page.getByText(label, { exact: true }) }).locator('small');
}

function reportTotal(page: Page, term: 'Total time' | 'Entries') {
  return page.locator('.report-totals > div').filter({ has: page.getByText(term, { exact: true }) }).locator('dd');
}

test('day, today and week totals and attribution follow the account time zone in the list, calendar and reports', async ({ page, data }) => {
  // Madrid times (CEST); Tokyo is seven hours ahead.
  await data.createEntry({ description: 'Saturday block', start: '2026-06-13T08:00:00Z', stop: '2026-06-13T10:00:00Z' }); // Sat 10:00-12:00
  await data.createEntry({ description: 'Sunday late', start: '2026-06-14T21:30:00Z', stop: '2026-06-14T21:50:00Z' }); // Sun 23:30-23:50, Mon in Tokyo
  await data.createEntry({ description: 'Across midnight', start: '2026-06-14T21:55:00Z', stop: '2026-06-14T22:55:00Z' }); // Sun 23:55-Mon 00:55
  await data.createEntry({ description: 'Monday work', start: '2026-06-15T05:00:00Z', stop: '2026-06-15T06:30:00Z' }); // Mon 07:00-08:30
  await data.createEntry({ description: 'Monday evening', start: '2026-06-15T17:00:00Z', stop: '2026-06-15T17:45:00Z' }); // Mon 19:00-19:45, Tue in Tokyo
  // Monday 2026-06-15 20:00 in Madrid, already Tuesday 03:00 in Tokyo. Weeks start on Monday.
  await page.clock.setFixedTime(new Date('2026-06-15T18:00:00Z'));
  await login(page);
  await expectBrowserTimeZone(page, 'Asia/Tokyo');

  // Entries count on the Madrid day they start: today is Monday, so the week so far is Monday only.
  await expect(summaryTotal(page, 'Today')).toHaveText('2:15:00');
  await expect(summaryTotal(page, 'This week')).toHaveText('2:15:00');
  await expect.poll(() => descriptions(page, 'Today')).toEqual(['Monday evening', 'Monday work']);
  await expect(dayGroup(page, 'Today').locator('.day-total')).toHaveText('2:15:00');
  await expect.poll(() => descriptions(page, 'Yesterday')).toEqual(['Across midnight', 'Sunday late']);
  await expect(dayGroup(page, 'Yesterday').locator('.day-total')).toHaveText('1:20:00');
  await expect.poll(() => descriptions(page, 'Sat, 13 Jun')).toEqual(['Saturday block']);
  await expect(dayGroup(page, 'Sat, 13 Jun').locator('.day-total')).toHaveText('2:00:00');
  await expect(page.locator('.day-group')).toHaveCount(3);

  // The calendar week is Madrid's Monday to Sunday; the entry across midnight shows its first
  // 55 minutes on Monday but counts toward Sunday, where it starts.
  await openCalendar(page);
  await expect(page.locator('.calendar-range')).toHaveText('15 Jun to 21 Jun');
  await expect(page.locator('.calendar-day-head').first()).toContainText('Today');
  await expect(calendarDayTotal(page, 'Today')).toHaveText('2:15:00');
  await expect(page.locator('.calendar-toolbar strong')).toHaveText('2:15:00');
  await expect(todayBlock(page, 'Across midnight')).toHaveCSS('top', '0px');
  await expect(todayBlock(page, 'Across midnight')).toHaveCSS('height', px(55));
  await expect(todayBlock(page, 'Monday work')).toHaveCSS('top', px(7 * 60));
  await expect(todayBlock(page, 'Monday evening')).toHaveCSS('top', px(19 * 60));
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page.locator('.calendar-range')).toHaveText('8 Jun to 14 Jun');
  await expect(calendarDayTotal(page, 'Yesterday')).toHaveText('1:20:00');
  await expect(calendarDayTotal(page, 'Sat, 13 Jun')).toHaveText('2:00:00');
  await expect(page.locator('.calendar-toolbar strong')).toHaveText('3:20:00');

  // Reports group by the Madrid day each entry starts on.
  await page.goto('/reports?from=2026-06-15&to=2026-06-15');
  await expect(reportTotal(page, 'Total time')).toHaveText('2:15:00');
  await expect(reportTotal(page, 'Entries')).toHaveText('2');
  await page.goto('/reports?from=2026-06-08&to=2026-06-14');
  await expect(reportTotal(page, 'Total time')).toHaveText('3:20:00');
  await expect(reportTotal(page, 'Entries')).toHaveText('3');
  await page.goto('/reports?from=2026-06-13&to=2026-06-15&tab=detailed');
  const rows = page.locator('tr.entry-row');
  await expect(rows).toHaveCount(5);
  const dated = await rows.evaluateAll((trs) => trs.map((tr) => {
    const cells = tr.querySelectorAll('td');
    return `${cells[0]!.textContent!.trim()} ${cells[1]!.textContent!.trim()}`;
  }));
  expect(dated.sort()).toEqual([
    '2026-06-13 Saturday block',
    '2026-06-14 Across midnight',
    '2026-06-14 Sunday late',
    '2026-06-15 Monday evening',
    '2026-06-15 Monday work',
  ]);
});

test('Show more days reaches an entry older than 90 days', async ({ page, data }) => {
  // Today is Monday 2026-06-15 in Madrid; the old entry is 100 days earlier.
  await data.createEntry({ description: 'Recent entry', start: '2026-06-15T07:00:00Z', stop: '2026-06-15T08:00:00Z' });
  await data.createEntry({ description: 'Old entry', start: '2026-03-07T09:00:00Z', stop: '2026-03-07T10:30:00Z' });
  await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
  await login(page);
  await expectBrowserTimeZone(page, 'Asia/Tokyo');
  await expect(page.locator('input[value="Recent entry"]')).toBeVisible();

  const more = page.getByRole('button', { name: 'Show 14 more days' });
  const old = page.locator('input[value="Old entry"]');
  // Each click widens the list by 14 days. Six clicks show 98 days (from 2026-03-10); the seventh
  // shows 112 days (from 2026-02-24), which includes 2026-03-07.
  const requested: string[] = [];
  for (let days = 28; days <= 112; days += 14) {
    const from = new Date(Date.UTC(2026, 5, 15) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v9/me/time_entries' && url.searchParams.get('start_date') === from;
    });
    await more.click();
    expect((await loaded).status()).toBe(200);
    await expect(more).toBeEnabled();
    requested.push(from);
    if (days === 98) await expect(old).toHaveCount(0);
  }
  expect(requested.slice(-2)).toEqual(['2026-03-10', '2026-02-24']);
  await expect(old).toBeVisible();
  await expect(dayGroup(page, 'Sat, 7 Mar').locator('.day-total')).toHaveText('1:30:00');
});
