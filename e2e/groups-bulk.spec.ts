import { expect, test } from './fixtures.ts';
import { contrast, login } from './helpers.ts';
import { OtherDevice, daysAgo, entryRow, type EntryState } from './groups-refresh-tests-helpers.ts';

// Grouped rows edit every member through the bulk API (docs/PRD.md L3), and the bulk bar acts on
// entries selected across days (L8). Each scenario compares the stored entries with what the
// edit should have touched, so a wrong id in a bulk request shows up as a changed bystander.

let device: OtherDevice;
test.beforeEach(async ({ baseURL }) => { device = await OtherDevice.open(baseURL!); });
test.afterEach(async () => { await device.close(); });

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;

/** Expects the stored entries to equal `expected`, which lists every live entry by id. */
async function expectStored(expected: Record<number, EntryState>) {
  await expect.poll(() => device.states()).toEqual(expected);
}

test('editing a group changes every member and nothing else, and undo restores a deleted group', async ({ page }) => {
  const dayA = daysAgo(1);
  const dayB = daysAgo(2);
  const members = [
    await device.createEntry({ description: 'Group work', start: at(dayA, 9), stop: at(dayA, 10) }),
    await device.createEntry({ description: 'Group work', start: at(dayA, 10), stop: at(dayA, 11) }),
    await device.createEntry({ description: 'Group work', start: at(dayA, 11), stop: at(dayA, 12) }),
  ];
  // Same fields on another day: a separate group, so not a member.
  const otherDay = await device.createEntry({ description: 'Group work', start: at(dayB, 9), stop: at(dayB, 10) });
  // Same day, different description: a bystander row.
  const solo = await device.createEntry({ description: 'Solo work', start: at(dayA, 12), stop: at(dayA, 13) });
  const project = await device.createProject('Acme');
  await device.createTag('review');
  const memberIds = members.map((entry) => entry.id);
  const expected = await device.states();
  const editMembers = (changes: Partial<EntryState>) => {
    for (const id of memberIds) expected[id] = { ...expected[id]!, ...changes };
  };

  await login(page);
  const group = page.locator('.entry-row-wrap.grouped', { has: page.locator('.count-badge', { hasText: '3' }) });
  await expect(group).toHaveCount(1);
  const line = group.locator('.entry-line').first();

  await line.getByLabel('Description').fill('Group review');
  await line.getByLabel('Description').press('Enter');
  editMembers({ description: 'Group review' });
  await expectStored(expected);

  await line.locator('.entry-project').click();
  await page.locator('.picker-item', { hasText: 'Acme' }).click();
  editMembers({ project_id: project.id });
  await expectStored(expected);
  await expect(line.locator('.project-label')).toContainText('Acme');

  await line.locator('.entry-tags').click();
  await page.locator('.picker-check', { hasText: 'review' }).getByRole('checkbox').click();
  await page.keyboard.press('Escape');
  editMembers({ tags: ['review'] });
  await expectStored(expected);

  await line.getByRole('button', { name: 'Billable' }).click();
  editMembers({ billable: true });
  await expectStored(expected);
  await expect(group).toHaveCount(1);
  await expect(line.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');

  // Delete the group, then undo.
  await line.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Delete 3 entries' }).click();
  await expect(page.getByText('3 entries deleted')).toBeVisible();
  const remaining = { [otherDay.id]: expected[otherDay.id]!, [solo.id]: expected[solo.id]! };
  await expectStored(remaining);
  expect(await device.trashIds()).toEqual([...memberIds].sort((a, b) => a - b));
  await expect(page.locator('.count-badge')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectStored(expected);
  expect(await device.trashIds()).toEqual([]);
  await expect(group).toHaveCount(1);
});

test('bulk project, tags, billable and delete act on the entries selected across days', async ({ page }) => {
  const alpha = await device.createEntry({ description: 'Alpha', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  // Beta and Epsilon are never selected; expectStored checks they stay as they are.
  await device.createEntry({ description: 'Beta', start: at(daysAgo(1), 11), stop: at(daysAgo(1), 12) });
  const gamma = await device.createEntry({ description: 'Gamma', start: at(daysAgo(2), 9), stop: at(daysAgo(2), 10) });
  const delta = await device.createEntry({ description: 'Delta', start: at(daysAgo(2), 11), stop: at(daysAgo(2), 12) });
  await device.createEntry({ description: 'Epsilon', start: at(daysAgo(3), 9), stop: at(daysAgo(3), 10) });
  // Gamma keeps a tag of its own: adding tags must not replace it.
  await device.updateEntry(gamma.id, { tags: ['legacy'] });
  const project = await device.createProject('Acme');
  await device.createTag('reviewed');
  const selectedIds = [alpha.id, gamma.id, delta.id];
  const expected = await device.states();

  await login(page);
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  // Alpha by its own checkbox, Gamma and Delta through their day's checkbox; Beta and Epsilon stay out.
  const select = async () => {
    await entryRow(page, 'Alpha').getByLabel('Select entry').check();
    await page.locator('.day-group', { has: entryRow(page, 'Gamma') }).locator('.day-select input').check();
    await expect(bar.getByText('3 selected')).toBeVisible();
    await expect(page.locator('.entry-line.selected')).toHaveCount(3);
  };

  await select();
  // A selected row has a 3px bar on its left edge as well as the tint.
  const edge = (description: string) => entryRow(page, description).evaluate((element) => getComputedStyle(element).boxShadow);
  expect(await edge('Alpha')).toMatch(/ 3px 0px 0px 0px inset$/);
  expect(await edge('Beta')).toBe('none');
  await bar.getByRole('button', { name: 'Project' }).click();
  await page.locator('.picker-item', { hasText: 'Acme' }).click();
  await expect(page.getByText('Project updated')).toBeVisible();
  await expect(bar).toHaveCount(0);
  for (const id of selectedIds) expected[id] = { ...expected[id]!, project_id: project.id };
  await expectStored(expected);

  await select();
  await bar.getByRole('button', { name: 'Add tags' }).click();
  await page.locator('.picker-check', { hasText: 'reviewed' }).getByRole('checkbox').click();
  await expect(page.getByText('Tags added')).toBeVisible();
  for (const id of selectedIds) expected[id] = { ...expected[id]!, tags: [...expected[id]!.tags, 'reviewed'].sort() };
  await expectStored(expected);

  await select();
  await bar.getByRole('button', { name: 'Billable', exact: true }).click();
  await expect(page.getByText('Marked billable')).toBeVisible();
  for (const id of selectedIds) expected[id] = { ...expected[id]!, billable: true };
  await expectStored(expected);

  await select();
  await bar.getByRole('button', { name: 'Non-billable' }).click();
  await expect(page.getByText('Marked non-billable')).toBeVisible();
  for (const id of selectedIds) expected[id] = { ...expected[id]!, billable: false };
  await expectStored(expected);

  // Delete across days, then undo.
  await select();
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('3 entries deleted')).toBeVisible();
  const kept = Object.fromEntries(Object.entries(expected).filter(([id]) => !selectedIds.includes(Number(id))));
  await expectStored(kept);
  expect(await device.trashIds()).toEqual([...selectedIds].sort((a, b) => a - b));
  for (const name of ['Alpha', 'Gamma', 'Delta']) await expect(entryRow(page, name)).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expectStored(expected);
  expect(await device.trashIds()).toEqual([]);
  for (const name of ['Alpha', 'Gamma', 'Delta']) await expect(entryRow(page, name)).toHaveCount(1);
});

test('a bulk edit that fails for one entry reports it and keeps the other changes', async ({ page }) => {
  const alpha = await device.createEntry({ description: 'Alpha', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  await device.createEntry({ description: 'Beta', start: at(daysAgo(1), 11), stop: at(daysAgo(1), 12) });
  const gamma = await device.createEntry({ description: 'Gamma', start: at(daysAgo(2), 9), stop: at(daysAgo(2), 10) });
  const delta = await device.createEntry({ description: 'Delta', start: at(daysAgo(2), 11), stop: at(daysAgo(2), 12) });

  await login(page);
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await entryRow(page, 'Alpha').getByLabel('Select entry').check();
  await page.locator('.day-group', { has: entryRow(page, 'Gamma') }).locator('.day-select input').check();
  await expect(bar.getByText('3 selected')).toBeVisible();

  // Another device deletes Gamma while it is still selected here.
  await device.deleteEntry(gamma.id);
  const expected = await device.states();
  const bulk = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && /\/time_entries\/[\d,]+$/.test(new URL(response.url()).pathname));
  await bar.getByRole('button', { name: 'Billable', exact: true }).click();
  const result = await (await bulk).json() as { success: number[]; failure: Array<{ id: number; message: string }> };
  expect([...result.success].sort((a, b) => a - b)).toEqual([alpha.id, delta.id].sort((a, b) => a - b));
  expect(result.failure).toEqual([{ id: gamma.id, message: 'Time entry not found' }]);

  // An error toast is an alert with an icon and a spoken "Error:" prefix.
  const failure = page.getByRole('alert');
  await expect(failure).toHaveText(/^Error: 1 entries failed: Time entry not found/);
  await expect(failure.locator('svg.toast-icon')).toBeVisible();
  const [ink, paper] = await failure.evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor]);
  expect(contrast(ink!, paper!), 'error toast text on its --danger background').toBeGreaterThanOrEqual(4.5);
  for (const id of result.success) expected[id] = { ...expected[id]!, billable: true };
  await expectStored(expected);
  expect(await device.trashIds()).toEqual([gamma.id]);
});

test('a bulk delete that fails for one entry reports what was deleted and can undo it', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({
    status: 404, method: 'DELETE', path: /^\/api\/v9\/workspaces\/\d+\/time_entries\/\d+$/,
    reason: 'another device deleted the entry first',
  });
  const alpha = await device.createEntry({ description: 'Alpha', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  const beta = await device.createEntry({ description: 'Beta', start: at(daysAgo(1), 11), stop: at(daysAgo(1), 12) });
  const gamma = await device.createEntry({ description: 'Gamma', start: at(daysAgo(2), 9), stop: at(daysAgo(2), 10) });
  const delta = await device.createEntry({ description: 'Delta', start: at(daysAgo(2), 11), stop: at(daysAgo(2), 12) });

  await login(page);
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await entryRow(page, 'Alpha').getByLabel('Select entry').check();
  await page.locator('.day-group', { has: entryRow(page, 'Gamma') }).locator('.day-select input').check();
  await expect(bar.getByText('3 selected')).toBeVisible();

  await device.deleteEntry(gamma.id);
  const before = await device.states();
  await bar.getByRole('button', { name: 'Delete' }).click();

  // Every selected entry that still existed is deleted, the report counts them and names the failure.
  await expect.poll(async () => Object.keys(await device.states()).map(Number)).toEqual([beta.id]);
  expect(await device.trashIds()).toEqual([alpha.id, gamma.id, delta.id].sort((a, b) => a - b));
  const report = page.locator('.toast').last();
  await expect(report).toContainText('2 entries deleted');
  await expect(report).toContainText(/1 entr(y|ies) failed: Time entry not found/);

  // Undo brings back exactly the two this page deleted.
  await report.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => device.states()).toEqual(before);
  expect(await device.trashIds()).toEqual([gamma.id]);
});

// The timer bar writes its height to --timer-bar-height on <html>, and the bulk bar
// reads it to stick flush under the timer bar while a long selection scrolls on a desktop.
test('the bulk bar sticks flush under the timer bar while a long selection scrolls', async ({ page }) => {
  const day = daysAgo(2);
  for (let hour = 2; hour < 20; hour++) await device.createEntry({ description: `Long day ${hour}`, start: at(day, hour), stop: at(day, hour + 1) });

  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await page.locator('.day-group', { has: entryRow(page, 'Long day 2') }).locator('.day-select input').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar.getByText('18 selected')).toBeVisible();

  const height = await timer.evaluate((element) => (element as HTMLElement).offsetHeight);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--timer-bar-height'))).toBe(`${height}px`);
  expect(await bar.evaluate((element) => getComputedStyle(element).top)).toBe(`${height}px`);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect.poll(async () => (await timer.boundingBox())?.y).toBeCloseTo(0, 0);
  // offsetHeight rounds to whole pixels, so the bar may sit up to a pixel off the fractional edge.
  const gap = async () => {
    const [above, below] = [(await timer.boundingBox())!, (await bar.boundingBox())!];
    return Math.abs(below.y - (above.y + above.height));
  };
  await expect.poll(gap).toBeLessThanOrEqual(1);
});
