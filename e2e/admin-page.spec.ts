import { describedError, expect, inviteRow, openAdmin, test, userRow } from './admin-tests-helpers.ts';
import { EMAIL } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, openMore, tap } from './mobile-tests-helpers.ts';

// TT-0141: the admin area in the web app. The setup account is the e2e server's only admin;
// the users fixture adds regular accounts through invites and deletes them afterwards.

const LAST_ADMIN = 'At least one active admin must remain';

test('an admin changes a role, disables and enables an account, revokes its sessions and deletes it', async ({ page, data, users, runtimeErrors }) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  const accountOf = async () => (await data.listUsers()).find((user) => user.email === rita.account.email);
  await login(page);
  await openAdmin(page);

  const self = userRow(page, EMAIL);
  await expect(self).toContainText('(you)');
  await expect(self.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  const row = userRow(page, rita.account.email);
  await expect(row).toContainText('Regular Rita');
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  const role = row.getByLabel(`Role of ${rita.account.email}`);
  await expect(role).toHaveValue('user');
  await role.selectOption('admin');
  await expect(page.getByText(`${rita.account.email} is now an admin`)).toBeVisible();
  expect((await accountOf())?.role).toBe('admin');
  await role.selectOption('user');
  await expect(page.getByText(`${rita.account.email} is now a regular user`)).toBeVisible();
  expect((await accountOf())?.role).toBe('user');

  await row.getByRole('button', { name: `Disable ${rita.account.email}` }).click();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  expect((await accountOf())?.disabled_at).not.toBeNull();
  await row.getByRole('button', { name: `Enable ${rita.account.email}` }).click();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  expect((await accountOf())?.disabled_at).toBeNull();

  await row.getByRole('button', { name: `Revoke sessions of ${rita.account.email}` }).click();
  await expect(page.getByText(`Signed ${rita.account.email} out of every browser.`)).toBeVisible();

  // Delete asks for the email, says it cannot be undone and points to disabling instead.
  await row.getByRole('button', { name: `Delete ${rita.account.email}` }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${rita.account.email}?` });
  await expect(dialog).toContainText('It cannot be undone.');
  await expect(dialog).toContainText('disable the account instead');
  await expect(dialog).toContainText('export their data first');
  const confirmEmail = dialog.getByLabel(`Type ${rita.account.email} to confirm`);
  await confirmEmail.fill('someone-else@e2e.example');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(await describedError(confirmEmail)).toHaveText("Type the account's email to confirm");
  expect(await accountOf()).toBeDefined();

  // The server checks the email too; its 400 shows on the same field.
  runtimeErrors.allowResponse({
    status: 400, method: 'DELETE', path: /^\/api\/app\/admin\/users\/\d+$/, reason: 'the server refuses an email that differs from the account',
  });
  await page.route(`**/api/app/admin/users/${rita.userId}`, async (route) => {
    await route.continue({ postData: JSON.stringify({ email: 'someone-else@e2e.example' }) });
  }, { times: 1 });
  await confirmEmail.fill(rita.account.email);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(await describedError(confirmEmail)).toHaveText("Enter the account's email to confirm the deletion");
  expect(await accountOf()).toBeDefined();

  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Deleted ${rita.account.email}`)).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(await accountOf()).toBeUndefined();
});

test('an admin creates an invite, sees its link once, and revokes it', async ({ page, data }) => {
  await login(page);
  await openAdmin(page);
  const invites = page.locator('#invites');
  await expect(invites.getByText('No pending invites')).toBeVisible();

  await invites.getByLabel('Role', { exact: true }).selectOption('admin');
  await invites.getByLabel('Note (optional)').fill('For Sam in finance');
  await invites.getByRole('button', { name: 'Create invite' }).click();
  const link = invites.getByLabel('Invite link', { exact: true });
  await expect(link).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/invite\/[\w-]+$/);
  const url = (await link.textContent())!;
  const token = url.split('/invite/')[1]!;

  const row = inviteRow(page, 'For Sam in finance');
  await expect(row).toContainText('Admin');
  // The list never carries the link, here or in what the server sends for it.
  await expect(page.locator('#invites table')).not.toContainText(token);
  const listed = await data.inviteList();
  expect(listed).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain(token);

  // The link works, and it is gone from the page after a reload.
  const lookup = await page.request.get(`/api/app/invites/${token}`);
  expect(await lookup.json()).toEqual({ role: 'admin' });
  await page.reload();
  await expect(row).toBeVisible();
  await expect(page.getByLabel('Invite link', { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain(token);

  await row.getByRole('button', { name: 'Revoke invite "For Sam in finance"' }).click();
  await expect(page.getByText('Invite revoked. Its link no longer works.')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(invites.getByText('No pending invites')).toBeVisible();
  expect(await data.inviteList()).toEqual([]);
});

test('an admin updates the instance settings, and an out-of-range value shows the server error on its field', async ({ page, data, runtimeErrors }) => {
  await login(page);
  await openAdmin(page);
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  const inviteDays = card.getByLabel('Invite link lifetime (days)');
  await expect(sessionDays).toHaveValue('30');
  await expect(inviteDays).toHaveValue('7');

  await sessionDays.fill('14');
  await inviteDays.fill('3');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toEqual({ session_days: 14, invite_days: 3 });

  runtimeErrors.allowResponse({
    status: 400, method: 'PUT', path: /^\/api\/app\/admin\/settings$/, reason: 'invite_days 91 is over the 90-day limit',
  });
  await inviteDays.fill('91');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Invalid invite_days: expected an integer from 1 to 90');
  await expect(inviteDays).toBeFocused();
  await expect(sessionDays).not.toHaveAttribute('aria-invalid', 'true');
  expect(await data.instanceSettings()).toEqual({ session_days: 14, invite_days: 3 });

  // Typing clears the error; a value that is not a whole number never reaches the server.
  await inviteDays.fill('');
  await expect(inviteDays).not.toHaveAttribute('aria-invalid', 'true');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Enter a whole number of days');
});

test('demoting or disabling the last active admin shows the 400 next to that control', async ({ page, data, runtimeErrors }) => {
  runtimeErrors.allowResponse({
    status: 400, method: 'PATCH', path: /^\/api\/app\/admin\/users\/\d+$/, reason: 'the setup account is the only active admin',
  });
  await login(page);
  await openAdmin(page);
  const row = userRow(page, EMAIL);

  const role = row.getByLabel(`Role of ${EMAIL}`);
  await role.selectOption('user');
  const roleError = await describedError(role);
  await expect(roleError).toHaveText(LAST_ADMIN);
  await expect(row.locator('td').nth(1)).toContainText(LAST_ADMIN);
  await expect(role).toHaveValue('admin');
  await expect(role).toBeFocused();

  const disable = row.getByRole('button', { name: `Disable ${EMAIL}` });
  await disable.click();
  const statusError = await describedError(disable);
  await expect(statusError).toHaveText(LAST_ADMIN);
  await expect(row.locator('td').nth(2)).toContainText(LAST_ADMIN);
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await expect(disable).toBeFocused();

  // Errors stay inline: no toast repeats them.
  await expect(page.locator('.toast')).toHaveCount(0);
  const [account] = await data.listUsers();
  expect(account).toMatchObject({ email: EMAIL, role: 'admin', disabled_at: null });
});

test('a regular user sees no Admin entry, and opening /admin shows the server\'s 403 message', async ({ page, users, runtimeErrors }) => {
  const rita = await users.create();
  runtimeErrors.allowResponse({
    status: 403, method: 'GET', path: /^\/api\/app\/admin\/users$/, reason: 'a regular user opens /admin directly',
  });
  await loginAs(page, rita.account);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);

  const refused = page.waitForResponse((response) => response.url().endsWith('/api/app/admin/users'));
  await page.goto('/admin');
  expect((await refused).status()).toBe(403);
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Admin access required');
  await expect(page.locator('#users')).toHaveCount(0);
});

test('every admin control is reachable by keyboard and shows a focus ring', async ({ page, data, users }) => {
  await users.create();
  await data.createInvite({ role: 'user', note: 'Keyboard check' });
  await login(page);
  await openAdmin(page);
  await expect(inviteRow(page, 'Keyboard check')).toBeVisible();

  const total = await page.getByRole('main').evaluate((main) => {
    const controls = [...main.querySelectorAll<HTMLElement>('a[href], button, select, input, textarea')]
      .filter((control) => !(control as HTMLButtonElement).disabled);
    controls.forEach((control, index) => control.setAttribute('data-keyboard-check', String(index)));
    return controls.length;
  });
  expect(total).toBeGreaterThan(10);

  await page.getByRole('heading', { level: 1, name: 'Admin' }).click();
  const reached = new Set<string>();
  for (let press = 0; press < total + 20 && reached.size < total; press++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        id: element.getAttribute('data-keyboard-check'),
        name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
        outline: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });
    if (!focused?.id) continue;
    expect(focused.outline, `${focused.name} shows a focus ring`).not.toBe('none');
    expect(focused.width, `${focused.name} has a 2px ring`).toBeGreaterThanOrEqual(2);
    reached.add(focused.id);
  }
  expect(reached.size, 'Tab reaches every control on the page').toBe(total);
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the Admin entry sits in More, and the admin page fits the screen', async ({ page, users }) => {
    const rita = await users.create();
    await login(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    const sheet = await openMore(page);
    await tap(sheet.getByRole('link', { name: 'Admin', exact: true }));
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveClass(/\bactive\b/);
    await expect(userRow(page, rita.account.email)).toBeVisible();
    await expectNoPageOverflow(page);

    await tap(page.locator('#invites').getByRole('button', { name: 'Create invite' }));
    await expectFits(page.getByLabel('Invite link', { exact: true }));
    await expectFits(page.getByRole('button', { name: 'Copy link' }));
    await expectFits(page.locator('#instance').getByRole('button', { name: 'Save' }));
    await expectFits(userRow(page, rita.account.email).getByRole('button', { name: `Delete ${rita.account.email}` }));
    await expectNoPageOverflow(page);
  });

  test('a regular user finds no Admin entry in More', async ({ page, users }) => {
    const rita = await users.create();
    await loginAs(page, rita.account);
    const sheet = await openMore(page);
    await expect(sheet.getByRole('link', { name: 'Trash' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });
});
