import { describedError, expect, inviteRow, openAdmin, test, userRow } from './admin-tests-helpers.ts';
import { EMAIL } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, openMore, tap } from './mobile-tests-helpers.ts';

// The admin area in the web app. The setup account is the e2e server's only admin;
// the users fixture adds regular accounts through invites, and the data fixture deletes them
// afterwards.

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

// The admin gets a one-time link and passes it on; the admin never sees or sets the password.
test('an admin issues a password reset link, sees it once, and a new one replaces it', async ({ page, data, users }) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  await login(page);
  await openAdmin(page);
  await expect(userRow(page, EMAIL).getByRole('button', { name: /^Reset password of / })).toHaveCount(0);

  const reset = userRow(page, rita.account.email).getByRole('button', { name: `Reset password of ${rita.account.email}` });
  const linkOf = page.getByLabel(`Password reset link for ${rita.account.email}`, { exact: true });
  await reset.click();
  await expect(linkOf).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/reset\/[\w-]+$/);
  await expect(page.locator('#users')).toContainText('works once, for 24 hours');
  // A reset replaces the API token, so the admin is told the user's apps must sign in again.
  await expect(page.locator('#users')).toContainText('replaces their API token');
  const first = (await linkOf.textContent())!.split('/reset/')[1]!;
  const check = (token: string) => page.request.get(`/api/app/password-resets/${token}`);
  expect(await (await check(first)).json()).toEqual({ email: rita.account.email });
  expect(JSON.stringify(await data.listUsers())).not.toContain(first);

  // A second link replaces the first, which stops working.
  await reset.click();
  await expect(linkOf).not.toHaveText(new RegExp(first));
  const second = (await linkOf.textContent())!.split('/reset/')[1]!;
  expect((await check(first)).status()).toBe(404);
  expect((await check(second)).status()).toBe(200);

  await page.reload();
  await expect(userRow(page, rita.account.email)).toBeVisible();
  await expect(linkOf).toHaveCount(0);
  expect(await page.content()).not.toContain(second);
});

// The one-time invite and reset links are shown once, so Copy link must hand over the exact link.
test('Copy link puts the invite link and the reset link on the clipboard', async ({ page, users, baseURL }) => {
  const rita = await users.create();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await login(page);
  await openAdmin(page);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  const invites = page.locator('#invites');
  await invites.getByRole('button', { name: 'Create invite' }).click();
  const invite = (await invites.getByLabel('Invite link', { exact: true }).textContent())!;
  await invites.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invite link copied' })).toBeVisible();
  expect(await clipboard()).toBe(invite);

  const usersCard = page.locator('#users');
  await userRow(page, rita.account.email).getByRole('button', { name: `Reset password of ${rita.account.email}` }).click();
  const reset = (await page.getByLabel(`Password reset link for ${rita.account.email}`, { exact: true }).textContent())!;
  await usersCard.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reset link copied' })).toBeVisible();
  expect(await clipboard()).toBe(reset);
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
  expect(await data.instanceSettings()).toEqual({ session_days: 14, invite_days: 3, time_resolution_minutes: 5 });

  runtimeErrors.allowResponse({
    status: 400, method: 'PUT', path: /^\/api\/app\/admin\/settings$/, reason: 'invite_days 91 is over the 90-day limit',
  });
  await inviteDays.fill('91');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Invalid invite_days: expected an integer from 1 to 90');
  await expect(inviteDays).toBeFocused();
  await expect(sessionDays).not.toHaveAttribute('aria-invalid', 'true');
  expect(await data.instanceSettings()).toEqual({ session_days: 14, invite_days: 3, time_resolution_minutes: 5 });

  // Typing clears the error; a value that is not a whole number never reaches the server.
  await inviteDays.fill('');
  await expect(inviteDays).not.toHaveAttribute('aria-invalid', 'true');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Enter a whole number of days');
});

test('an admin saves the time resolution, every account reads it on /me, and a value that does not divide an hour shows the server error', async ({ page, data, users, runtimeErrors }) => {
  const rita = await users.create();
  expect(await rita.me()).toMatchObject({ role: 'user', time_resolution_minutes: 5 });
  await login(page);
  await openAdmin(page);
  const card = page.locator('#instance');
  const resolution = card.getByLabel('Time resolution (minutes)');
  await expect(resolution).toHaveValue('5');
  await expect(card.getByText('Entries are rounded up to this many minutes. Existing entries change only when they are edited.')).toBeVisible();

  await resolution.fill('15');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toEqual({ session_days: 30, invite_days: 7, time_resolution_minutes: 15 });
  // The admin's save is what a regular account, which cannot read the admin settings, now gets on /me.
  expect(await rita.me()).toMatchObject({ role: 'user', time_resolution_minutes: 15 });
  expect(await data.me()).toMatchObject({ role: 'admin', time_resolution_minutes: 15 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await expect(resolution).toHaveValue('15');

  runtimeErrors.allowResponse({
    status: 400, method: 'PUT', path: /^\/api\/app\/admin\/settings$/, reason: 'a time resolution of 7 minutes does not divide an hour',
  });
  await resolution.fill('7');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(resolution))
    .toHaveText('Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60');
  await expect(resolution).toBeFocused();
  await expect(card.getByLabel('Session length (days)')).not.toHaveAttribute('aria-invalid', 'true');
  expect((await data.instanceSettings()).time_resolution_minutes).toBe(15);

  // A value that is not a whole number never reaches the server, and the message names minutes.
  await resolution.fill('');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(resolution)).toHaveText('Enter a whole number of minutes');
});

// Another admin's change arrives with a background refetch while this admin is typing.
test('a refetch keeps an unsaved instance setting and its focus, and updates the untouched one', async ({ page, data }) => {
  await login(page);
  await openAdmin(page);
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  const inviteDays = card.getByLabel('Invite link lifetime (days)');
  await expect(inviteDays).toHaveValue('7');

  await sessionDays.fill('21');
  await data.saveInstanceSettings({ session_days: 45, invite_days: 5 });
  // Window focus refetches stale queries, at most once a second (packages/web/src/main.tsx).
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(inviteDays).toHaveValue('5', { timeout: 1500 });
  }).toPass();
  await expect(sessionDays).toHaveValue('21');
  await expect(sessionDays).toBeFocused();

  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toEqual({ session_days: 21, invite_days: 5, time_resolution_minutes: 5 });
  await expect(sessionDays).toHaveValue('21');
  await expect(inviteDays).toHaveValue('5');
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

// When a row goes away, focus moves to the same control in the next row, else the
// previous row, else the section heading. Closing a new link returns focus to what created it.
test('revoking invites by keyboard keeps focus in the invites section', async ({ page, data }) => {
  for (const note of ['Invite A', 'Invite B', 'Invite C']) await data.createInvite({ role: 'user', note });
  await login(page);
  await openAdmin(page);
  const revoke = (note: string) => inviteRow(page, note).getByRole('button', { name: `Revoke invite "${note}"` });

  await revoke('Invite B').focus();
  await page.keyboard.press('Enter');
  await expect(inviteRow(page, 'Invite B')).toHaveCount(0);
  await expect(revoke('Invite C')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(inviteRow(page, 'Invite C')).toHaveCount(0);
  await expect(revoke('Invite A')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#invites').getByText('No pending invites')).toBeVisible();
  const heading = page.locator('#invites').getByRole('heading', { name: 'Pending invites' });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveCSS('outline-width', '2px');

  const create = page.locator('#invites').getByRole('button', { name: 'Create invite' });
  await create.focus();
  await page.keyboard.press('Enter');
  const done = page.locator('#invites').getByRole('button', { name: 'Done' });
  await expect(done).toBeVisible();
  await done.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Invite link', { exact: true })).toHaveCount(0);
  await expect(create).toBeFocused();
});

test('deleting users by keyboard keeps focus in the users section', async ({ page, users }) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  const sam = await users.create({ fullname: 'Regular Sam' });
  await login(page);
  await openAdmin(page);
  const button = (email: string, action: string) => userRow(page, email).getByRole('button', { name: `${action} ${email}` });

  // A reset link's Done button goes away with the link; focus goes back to the button that made it.
  await button(rita.account.email, 'Reset password of').focus();
  await page.keyboard.press('Enter');
  const done = page.locator('#users').getByRole('button', { name: 'Done' });
  await expect(done).toBeVisible();
  await done.focus();
  await page.keyboard.press('Enter');
  await expect(done).toHaveCount(0);
  await expect(button(rita.account.email, 'Reset password of')).toBeFocused();

  const remove = async (email: string) => {
    await button(email, 'Delete').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Delete ${email}?` });
    await expect(dialog.getByLabel(`Type ${email} to confirm`)).toBeFocused();
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(userRow(page, email)).toHaveCount(0);
  };
  await remove(rita.account.email);
  await expect(button(sam.account.email, 'Delete')).toBeFocused();
  // Only the signed-in admin is left, and its row has no Delete button.
  await remove(sam.account.email);
  await expect(page.locator('#users').getByRole('heading', { name: 'Users' })).toBeFocused();
});

// A dialog closed without acting gives focus back to the control that opened it.
test('closing the delete dialog without deleting returns focus to its Delete button', async ({ page, users }) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  await login(page);
  await openAdmin(page);
  const email = rita.account.email;
  const remove = userRow(page, email).getByRole('button', { name: `Delete ${email}` });
  const dialog = page.getByRole('dialog', { name: `Delete ${email}?` });
  const pressButton = async (name: string) => {
    await dialog.getByRole('button', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
  };
  const closers: Array<[string, () => Promise<void>]> = [
    ['Escape', () => page.keyboard.press('Escape')],
    ['Cancel', () => pressButton('Cancel')],
    ['Close', () => pressButton('Close')],
    // A press on the backdrop must not leave focus on the page behind it.
    ['a backdrop click', () => page.mouse.click(5, 5)],
  ];
  for (const [how, close] of closers) {
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel(`Type ${email} to confirm`)).toBeFocused();
    await close();
    await expect(dialog).toBeHidden();
    await expect(remove, `focus after ${how}`).toBeFocused();
  }
});

// A field changed back to the server's value is no longer an edit, so a refetch updates it,
// and saving sends only the fields that are still edited.
test('an instance setting restored to the server value follows refetches, and saving sends only edited fields', async ({ page, data }) => {
  const before = await data.instanceSettings();
  try {
    await login(page);
    await openAdmin(page);
    const card = page.locator('#instance');
    const sessionDays = card.getByLabel('Session length (days)');
    const inviteDays = card.getByLabel('Invite link lifetime (days)');
    await expect(sessionDays).toHaveValue(String(before.session_days));

    await sessionDays.fill(String(before.session_days + 1));
    await sessionDays.fill(String(before.session_days));
    const changed = before.session_days === 60 ? 61 : 60;
    await data.saveInstanceSettings({ session_days: changed, invite_days: before.invite_days });
    // Window focus refetches stale queries, at most once a second (packages/web/src/main.tsx).
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(sessionDays).toHaveValue(String(changed), { timeout: 1500 });
    }).toPass();
    // With no field edited, Save sends nothing.
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('No changes to save')).toBeVisible();

    // Another admin changes the session length while this one edits only the invite lifetime.
    const invite = before.invite_days === 10 ? 11 : 10;
    await inviteDays.fill(String(invite));
    await data.saveInstanceSettings({ session_days: 90, invite_days: before.invite_days });
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Instance settings saved')).toBeVisible();
    expect(await data.instanceSettings()).toEqual({
      session_days: 90, invite_days: invite, time_resolution_minutes: before.time_resolution_minutes,
    });
    await expect(sessionDays).toHaveValue('90');
    await expect(inviteDays).toHaveValue(String(invite));
  } finally {
    await data.saveInstanceSettings(before);
  }
});

// The admin types the old value back while the save is still on its way.
test('a value typed while a save is pending stays after the response, and Save sends it', async ({ page, data }) => {
  const before = await data.instanceSettings();
  const changed = before.session_days === 60 ? 61 : 60;
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/app/admin/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) await held;
    await route.fallback();
  });
  await login(page);
  await openAdmin(page);
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  await expect(sessionDays).toHaveValue(String(before.session_days));

  await sessionDays.fill(String(changed));
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(1);
  await sessionDays.fill(String(before.session_days));
  release();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect((await data.instanceSettings()).session_days).toBe(changed);
  await expect(sessionDays).toHaveValue(String(before.session_days));

  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ session_days: before.session_days });
  await expect.poll(async () => (await data.instanceSettings()).session_days).toBe(before.session_days);
  await expect(sessionDays).toHaveValue(String(before.session_days));
});

// When the pending save fails, the server's value has not changed, so a value typed back to
// it is no longer an edit, while a different value typed meanwhile stays one.
test('after a failed save, a value typed back to the server value is no longer an edit', async ({ page, data, runtimeErrors }) => {
  const before = await data.instanceSettings();
  const changed = before.session_days === 60 ? 61 : 60;
  const invite = before.invite_days === 10 ? 11 : 10;
  runtimeErrors.allowResponse({
    status: 503, method: 'PUT', path: /^\/api\/app\/admin\/settings$/, reason: 'the held save is answered with an outage',
  });
  let sent = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/app/admin/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    sent += 1;
    await held;
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Server unavailable' });
  });
  await login(page);
  await openAdmin(page);
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  const inviteDays = card.getByLabel('Invite link lifetime (days)');
  await expect(sessionDays).toHaveValue(String(before.session_days));

  await sessionDays.fill(String(changed));
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent).toBe(1);
  await sessionDays.fill(String(before.session_days));
  await inviteDays.fill(String(invite));
  release();
  await expect(page.getByRole('alert').filter({ hasText: 'Server unavailable' })).toBeVisible();
  await expect(sessionDays).toHaveValue(String(before.session_days));
  await expect(inviteDays).toHaveValue(String(invite));
  expect(await data.instanceSettings()).toEqual(before);

  // Another admin's change reaches the field that is no longer edited, not the one that is.
  const other = before.session_days === 90 ? 91 : 90;
  await data.saveInstanceSettings({ session_days: other, invite_days: before.invite_days });
  try {
    // Window focus refetches stale queries, at most once a second (packages/web/src/main.tsx).
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(sessionDays).toHaveValue(String(other), { timeout: 1500 });
    }).toPass();
    await expect(inviteDays).toHaveValue(String(invite));
  } finally {
    await data.saveInstanceSettings(before);
  }
});

test('every admin control is reachable by keyboard and shows a focus ring',async ({ page, data, users }) => {
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
