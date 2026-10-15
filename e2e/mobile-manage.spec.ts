import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, openMore, tap, tapNav } from './mobile-tests-helpers.ts';

test.use(PHONE);

test('the bottom navigation reaches every page and stays usable after scrolling a long list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  for (let i = 1; i <= 40; i++) await api.createTag(`tag ${String(i).padStart(2, '0')}`);

  for (const name of ['Reports', 'Projects', 'Clients', 'Tags', 'Trash', 'Settings', 'Timer']) await tapNav(page, name);

  // Forty tags make the page scroll; the fixed navigation stays on screen and tappable.
  await tapNav(page, 'Tags');
  const last = page.getByRole('button', { name: 'Delete tag 40' });
  await expect(last).toBeAttached();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = (await nav.boundingBox())!;
  expect([Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)]).toEqual([0, 390, 844]);
  // The last row is not hidden behind the navigation.
  await tap(last);
  const confirm = page.getByRole('dialog', { name: 'Delete tag 40?' });
  await expectFits(confirm);
  await tap(confirm.getByRole('button', { name: 'Delete tag' }));
  await expect(confirm).toBeHidden();
  expect((await api.tags()).map((tag) => tag.name)).not.toContain('tag 40');
  await expect.poll(async () => (await api.tags()).length).toBe(39);

  await tapNav(page, 'Settings');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await tapNav(page, 'Timer');
});

test('client and tag dialogs and menus finish by touch on a phone and save what the desktop saves', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);

  // Client dialog, then archive through its confirmation.
  await tapNav(page, 'Clients');
  await tap(page.getByRole('button', { name: 'New client' }));
  const clientEditor = page.getByRole('dialog', { name: 'New client' });
  await expectFits(clientEditor);
  await clientEditor.getByLabel('Name').fill('Northwind');
  await clientEditor.getByLabel('Notes').fill('Net 30');
  await tap(clientEditor.getByRole('button', { name: 'Create client' }));
  await expect(clientEditor).toBeHidden();
  const [client] = await api.clients();
  expect(client).toMatchObject({ name: 'Northwind', notes: 'Net 30', archived: false });
  await tap(page.getByRole('button', { name: 'More actions for Northwind', exact: true }));
  const menu = page.getByRole('menu');
  await expectFits(menu);
  await tap(menu.getByRole('menuitem', { name: 'Archive' }));
  const confirm = page.getByRole('dialog', { name: 'Archive Northwind?' });
  await expectFits(confirm);
  await tap(confirm.getByRole('button', { name: 'Archive' }));
  await expect(confirm).toBeHidden();
  expect((await api.client(client!.id)).archived).toBe(true);
  await expectNoPageOverflow(page);

  // Tags: add, rename by tapping the chip and then the heading, delete through the dialog.
  await tapNav(page, 'Tags');
  await page.getByRole('textbox', { name: 'New tag name' }).fill('phone');
  await tap(page.getByRole('button', { name: 'Add tag' }));
  await expect.poll(async () => (await api.tags()).map((t) => t.name)).toEqual(['phone']);
  await tap(page.getByRole('button', { name: 'phone', exact: true }));
  await page.getByRole('textbox', { name: 'New name for phone' }).fill('handset');
  await tap(page.getByRole('heading', { name: 'Tags', level: 1 }));
  await expect(page.getByText('Renamed to handset')).toBeVisible();
  expect((await api.tags()).map((t) => t.name)).toEqual(['handset']);
  await tap(page.getByRole('button', { name: 'Delete handset' }));
  const deleteTag = page.getByRole('dialog', { name: 'Delete handset?' });
  await expectFits(deleteTag);
  await tap(deleteTag.getByRole('button', { name: 'Delete tag' }));
  await expect(deleteTag).toBeHidden();
  expect(await api.tags()).toEqual([]);
  await expectNoPageOverflow(page);
});

// The Projects table is wider than a phone. It must scroll inside its wrapper: anything escaping
// the wrapper widens the page, and the fixed navigation stretches off screen with it (TT-0064).
test('the Projects page fits a phone, and its editor and row menu finish by touch', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const project = await api.createProject({ name: 'Website' });
  for (let i = 1; i <= 24; i++) await api.createProject({ name: `Project ${String(i).padStart(2, '0')}` });

  // tapNav checks that the page does not scroll sideways.
  await tapNav(page, 'Projects');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = (await nav.boundingBox())!;
  expect([Math.round(box.x), Math.round(box.width)]).toEqual([0, 390]);
  // Four pages and More fit the bar; the other pages and Log out fit the More sheet.
  await expect(nav.locator(':scope > a, :scope > button')).toHaveCount(5);
  for (const name of ['Timer', 'Reports', 'Projects', 'Settings']) {
    await expectFits(nav.getByRole('link', { name, exact: true }));
  }
  const more = nav.getByRole('button', { name: 'More', exact: true });
  const sheet = await openMore(page);
  for (const name of ['Clients', 'Tags', 'Trash']) await expectFits(sheet.getByRole('link', { name, exact: true }));
  await expectFits(sheet.getByRole('button', { name: 'Log out' }));
  await expectNoPageOverflow(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();

  // The last row of a long list is reachable above the navigation.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await tap(page.getByRole('button', { name: 'Edit Project 24' }));
  await tap(page.getByRole('dialog', { name: 'Edit project' }).getByRole('button', { name: 'Cancel' }));

  await tap(page.getByRole('button', { name: 'Edit Website' }));
  const editor = page.getByRole('dialog', { name: 'Edit project' });
  await expectFits(editor);
  await editor.getByLabel('Hourly rate').fill('95');
  await editor.getByLabel('Estimated hours').fill('10');
  await tap(editor.getByLabel('Billable by default'));
  await tap(editor.getByRole('button', { name: 'Save' }));
  await expect(editor).toBeHidden();
  expect(await api.project(project.id)).toMatchObject({ rate: 95, estimated_hours: 10, billable: true, active: true });
  await tap(page.getByRole('button', { name: 'More actions for Website', exact: true }));
  const menu = page.getByRole('menu');
  await expectFits(menu);
  await tap(menu.getByRole('menuitem', { name: 'Archive' }));
  await expect.poll(async () => (await api.project(project.id)).active).toBe(false);
  await expectNoPageOverflow(page);
});

// TT-0087: the phone header carries the wordmark; bar items are at least 44px each way with
// labels of 11px or more; the More sheet opens by keyboard and Tab stays inside it.
test('the bottom bar items are large enough to tap, and the More sheet works by keyboard', async ({ page }) => {
  await login(page);
  await expect(page.locator('.phone-header').getByRole('img', { name: 'Tokkl' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  const items = nav.locator(':scope > a, :scope > button');
  await expect(items).toHaveCount(5);
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!;
    expect(Math.min(box.width, box.height), `${await item.innerText()} is at least 44px each way`).toBeGreaterThanOrEqual(44);
    const label = await item.locator('span').first().evaluate((span) => parseFloat(getComputedStyle(span).fontSize));
    expect(label, `${await item.innerText()} label size`).toBeGreaterThanOrEqual(11);
  }

  const more = nav.getByRole('button', { name: 'More', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  const sheet = nav.getByRole('dialog', { name: 'More' });
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(sheet.getByRole('link', { name: 'Clients', exact: true })).toBeFocused();
  for (const name of ['Tags', 'Trash']) {
    await page.keyboard.press('Tab');
    await expect(sheet.getByRole('link', { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  const logout = sheet.getByRole('button', { name: 'Log out' });
  await expect(logout).toBeFocused();
  // Tab past the last control wraps to the first, the close button; Shift+Tab wraps back.
  const close = sheet.getByRole('button', { name: 'Close' });
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(logout).toBeFocused();

  await close.focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
});
