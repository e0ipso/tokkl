import {
  describedError,
  expect,
  inviteRow,
  mockSignupInvite,
  openAdmin,
  test,
  userRow,
} from './admin-tests-helpers.ts';
import { EMAIL } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, openMore, tap } from './mobile-tests-helpers.ts';

// The setup account is the e2e server's only admin; the users fixture adds regular accounts through invites.

const LAST_ADMIN = 'At least one active admin must remain';

test('admin sections are separate pages with direct links, reload and browser history', async ({ page }) => {
  await login(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/users$/);
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  const cards = page.locator('.settings-card');
  for (const [id, label] of [
    ['users', 'Users'],
    ['invites', 'Invites'],
    ['instance', 'Instance settings'],
  ] as const) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', `/admin/${id}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/${id}$`));
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute('id', id);
    await expect(cards.getByRole('heading', { level: 2, name: label, exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(cards).toHaveAttribute('id', id);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/invites$/);
  await expect(cards).toHaveAttribute('id', 'invites');
  await page.goForward();
  await expect(cards).toHaveAttribute('id', 'instance');
  await page.goto('/admin#invites');
  await expect(page).toHaveURL(/\/admin\/invites$/);
  await expect(cards).toHaveAttribute('id', 'invites');
  await page.goto('/admin/unknown');
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test('sign-up is disabled with an accessible description naming the missing mail settings', async ({ page }) => {
  await page.route('**/api/app/admin/settings', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        mail_configured: { configured: false, missing: ['TOKKL_SMTP_HOST', 'TOKKL_PUBLIC_URL'] },
      },
    });
  });
  await login(page);
  await openAdmin(page, 'Instance settings');
  const signup = page.locator('#instance').getByRole('checkbox', { name: 'Allow email sign-up' });
  await expect(signup).toBeDisabled();
  await expect(signup).not.toBeChecked();
  await expect(signup).toHaveAccessibleDescription('Sign-up needs mail settings: TOKKL_SMTP_HOST, TOKKL_PUBLIC_URL.');
  const description = await signup.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  await expect(page.locator(`[id="${description}"]`)).toBeVisible();
});

test('sign-up saves only the changed boolean and keeps a toggle made while saving', async ({ page, instance }) => {
  let stored = { ...instance, signup_enabled: false, mail_configured: { configured: true, missing: [] } };
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/app/admin/settings', async route => {
    if (route.request().method() === 'PUT') {
      const changes = route.request().postDataJSON();
      sent.push(changes);
      if (sent.length === 1) await held;
      stored = { ...stored, ...changes };
    }
    await route.fulfill({ json: stored });
  });
  await login(page);
  await openAdmin(page, 'Instance settings');
  const card = page.locator('#instance');
  const signup = card.getByRole('checkbox', { name: 'Allow email sign-up' });
  await expect(signup).toBeEnabled();
  await signup.check();
  await signup.uncheck();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No changes to save')).toBeVisible();
  expect(sent).toEqual([]);

  await signup.check();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => sent).toEqual([{ signup_enabled: true }]);
  await signup.uncheck();
  release();
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(signup).not.toBeChecked();
  expect(stored.signup_enabled).toBe(true);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => sent).toEqual([{ signup_enabled: true }, { signup_enabled: false }]);
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.reload();
  await expect(signup).not.toBeChecked();

  stored = { ...stored, signup_enabled: true };
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(signup).toBeChecked({ timeout: 1500 });
  }).toPass();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No changes to save')).toBeVisible();
  expect(sent).toHaveLength(2);
});

test('sign-up save errors use inline field validation and form alerts', async ({ page, instance, runtimeErrors }) => {
  const message = 'Invalid signup_enabled: expected true or false';
  const missingMail = 'Sign-up needs TOKKL_SMTP_FROM';
  let attempts = 0;
  runtimeErrors.allowResponse({
    status: 400,
    method: 'PUT',
    path: /^\/api\/app\/admin\/settings$/,
    reason: 'the server rejects a setting value and then reports missing mail configuration',
  });
  await page.route('**/api/app/admin/settings', async route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toEqual({ signup_enabled: true });
      await route.fulfill({ status: 400, json: attempts++ === 0 ? message : missingMail });
    } else {
      await route.fulfill({
        json: { ...instance, signup_enabled: false, mail_configured: { configured: true, missing: [] } },
      });
    }
  });
  await login(page);
  await openAdmin(page, 'Instance settings');
  const card = page.locator('#instance');
  const signup = card.getByRole('checkbox', { name: 'Allow email sign-up' });
  await signup.check();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(await describedError(signup)).toHaveText(message);
  await expect(signup).toBeFocused();
  await signup.uncheck();
  await expect(signup).not.toHaveAttribute('aria-invalid', 'true');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No changes to save')).toBeVisible();
  await signup.check();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: missingMail })).toBeVisible();
});

test('an admin changes a role, disables and enables an account, revokes its sessions and deletes it', async ({
  page,
  data,
  users,
  runtimeErrors,
}) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  const accountOf = async () => (await data.listUsers()).find(user => user.email === rita.account.email);
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
    status: 400,
    method: 'DELETE',
    path: /^\/api\/app\/admin\/users\/\d+$/,
    reason: 'the server refuses an email that differs from the account',
  });
  await page.route(
    `**/api/app/admin/users/${rita.userId}`,
    async route => {
      await route.continue({ postData: JSON.stringify({ email: 'someone-else@e2e.example' }) });
    },
    { times: 1 },
  );
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
  await openAdmin(page, 'Invites');
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
  await expect(page.locator('#invites table')).not.toContainText(token);
  const listed = await data.inviteList();
  expect(listed).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain(token);

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

test('sign-up invites show the target email and label, and both invite kinds can be revoked', async ({
  page,
  data,
}) => {
  const email = 'new-member@e2e.example';
  const id = await data.createInvite({ role: 'user', note: 'Original note' });
  await data.createInvite({ role: 'admin', note: 'For Sam in finance' });
  await mockSignupInvite(page, id, email);
  await login(page);
  await openAdmin(page, 'Invites');
  const signup = inviteRow(page, email);
  await expect(signup).toBeVisible();
  await expect(signup.getByRole('cell').first()).toHaveText('Sign-up');
  await expect(signup.getByRole('cell', { name: email, exact: true })).toHaveAttribute('title', email);
  await expect(signup).not.toContainText('Original note');
  const admin = inviteRow(page, 'For Sam in finance');
  await expect(admin.getByRole('cell').first()).toHaveText('Admin');
  await expect(page.locator('#invites')).toContainText(
    'Admin invite links are shared by hand; sign-up links are emailed.',
  );

  await signup.getByRole('button', { name: `Revoke sign-up invite for ${email}`, exact: true }).click();
  await expect(signup).toHaveCount(0);
  expect((await data.inviteList()).map(invite => invite.id)).not.toContain(id);
  await expect(admin).toBeVisible();
  await admin.getByRole('button', { name: 'Revoke invite "For Sam in finance"', exact: true }).click();
  await expect(admin).toHaveCount(0);
  expect(await data.inviteList()).toEqual([]);
});

test('an admin issues a password reset link, sees it once, and a new one replaces it', async ({
  page,
  data,
  users,
}) => {
  const rita = await users.create({ fullname: 'Regular Rita' });
  await login(page);
  await openAdmin(page);
  await expect(userRow(page, EMAIL).getByRole('button', { name: /^Reset password of / })).toHaveCount(0);

  const reset = userRow(page, rita.account.email).getByRole('button', {
    name: `Reset password of ${rita.account.email}`,
  });
  const linkOf = page.getByLabel(`Password reset link for ${rita.account.email}`, { exact: true });
  await reset.click();
  await expect(linkOf).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/reset\/[\w-]+$/);
  await expect(page.locator('#users')).toContainText('works once, for 24 hours');
  await expect(page.locator('#users')).toContainText('replaces their API token');
  const first = (await linkOf.textContent())!.split('/reset/')[1]!;
  const check = (token: string) => page.request.get(`/api/app/password-resets/${token}`);
  expect(await (await check(first)).json()).toEqual({ email: rita.account.email });
  expect(JSON.stringify(await data.listUsers())).not.toContain(first);

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

test('Copy link puts the invite link and the reset link on the clipboard', async ({ page, users, baseURL }) => {
  const rita = await users.create();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await login(page);
  await openAdmin(page, 'Invites');
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  const invites = page.locator('#invites');
  await invites.getByRole('button', { name: 'Create invite' }).click();
  const invite = (await invites.getByLabel('Invite link', { exact: true }).textContent())!;
  await invites.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invite link copied' })).toBeVisible();
  expect(await clipboard()).toBe(invite);

  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: 'Users', exact: true })
    .click();
  const usersCard = page.locator('#users');
  await userRow(page, rita.account.email)
    .getByRole('button', { name: `Reset password of ${rita.account.email}` })
    .click();
  const reset = (await page
    .getByLabel(`Password reset link for ${rita.account.email}`, { exact: true })
    .textContent())!;
  await usersCard.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reset link copied' })).toBeVisible();
  expect(await clipboard()).toBe(reset);
});

test('an admin updates the instance settings, and an out-of-range value shows the server error on its field', async ({
  page,
  data,
  runtimeErrors,
}) => {
  await login(page);
  await openAdmin(page, 'Instance settings');
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  const inviteDays = card.getByLabel('Invite link lifetime (days)');
  await expect(sessionDays).toHaveValue('30');
  await expect(inviteDays).toHaveValue('7');

  await sessionDays.fill('14');
  await inviteDays.fill('3');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toMatchObject({ session_days: 14, invite_days: 3, time_resolution_minutes: 5 });

  runtimeErrors.allowResponse({
    status: 400,
    method: 'PUT',
    path: /^\/api\/app\/admin\/settings$/,
    reason: 'invite_days 91 is over the 90-day limit',
  });
  await inviteDays.fill('91');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Invalid invite_days: expected an integer from 1 to 90');
  await expect(inviteDays).toBeFocused();
  await expect(sessionDays).not.toHaveAttribute('aria-invalid', 'true');
  expect(await data.instanceSettings()).toMatchObject({ session_days: 14, invite_days: 3, time_resolution_minutes: 5 });

  await inviteDays.fill('');
  await expect(inviteDays).not.toHaveAttribute('aria-invalid', 'true');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(inviteDays)).toHaveText('Enter a whole number of days');
});

test('an admin saves the time resolution, every account reads it on /me, and a value that does not divide an hour shows the server error', async ({
  page,
  data,
  users,
  runtimeErrors,
}) => {
  const rita = await users.create();
  expect(await rita.me()).toMatchObject({ role: 'user', time_resolution_minutes: 5 });
  await login(page);
  await openAdmin(page, 'Instance settings');
  const card = page.locator('#instance');
  const resolution = card.getByLabel('Time resolution (minutes)');
  await expect(resolution).toHaveValue('5');
  await expect(
    card.getByText(
      'Starts and stops move to the nearest multiple of this many minutes. A timer that rounds to zero goes to the trash, and a typed entry that rounds to zero is refused. Existing entries change only when they are edited.',
    ),
  ).toBeVisible();

  await resolution.fill('15');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toMatchObject({
    session_days: 30,
    invite_days: 7,
    time_resolution_minutes: 15,
  });
  expect(await rita.me()).toMatchObject({ role: 'user', time_resolution_minutes: 15 });
  expect(await data.me()).toMatchObject({ role: 'admin', time_resolution_minutes: 15 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await expect(resolution).toHaveValue('15');

  runtimeErrors.allowResponse({
    status: 400,
    method: 'PUT',
    path: /^\/api\/app\/admin\/settings$/,
    reason: 'a time resolution of 7 minutes does not divide an hour',
  });
  await resolution.fill('7');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(resolution)).toHaveText(
    'Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60',
  );
  await expect(resolution).toBeFocused();
  await expect(card.getByLabel('Session length (days)')).not.toHaveAttribute('aria-invalid', 'true');
  expect((await data.instanceSettings()).time_resolution_minutes).toBe(15);

  await resolution.fill('');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(resolution)).toHaveText('Enter a whole number of minutes');
});

test('a refetch keeps an unsaved instance setting and its focus, and updates the untouched one', async ({
  page,
  data,
}) => {
  await login(page);
  await openAdmin(page, 'Instance settings');
  const card = page.locator('#instance');
  const sessionDays = card.getByLabel('Session length (days)');
  const inviteDays = card.getByLabel('Invite link lifetime (days)');
  await expect(inviteDays).toHaveValue('7');

  await sessionDays.fill('21');
  await data.saveInstanceSettings({ session_days: 45, invite_days: 5 });
  // Window focus refetches stale queries, at most once a second.
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(inviteDays).toHaveValue('5', { timeout: 1500 });
  }).toPass();
  await expect(sessionDays).toHaveValue('21');
  await expect(sessionDays).toBeFocused();

  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Instance settings saved')).toBeVisible();
  expect(await data.instanceSettings()).toMatchObject({ session_days: 21, invite_days: 5, time_resolution_minutes: 5 });
  await expect(sessionDays).toHaveValue('21');
  await expect(inviteDays).toHaveValue('5');
});

test('demoting or disabling the last active admin shows the 400 next to that control', async ({
  page,
  data,
  runtimeErrors,
}) => {
  runtimeErrors.allowResponse({
    status: 400,
    method: 'PATCH',
    path: /^\/api\/app\/admin\/users\/\d+$/,
    reason: 'the setup account is the only active admin',
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

  await expect(page.locator('.toast')).toHaveCount(0);
  const [account] = await data.listUsers();
  expect(account).toMatchObject({ email: EMAIL, role: 'admin', disabled_at: null });
});

test("a regular user sees no Admin entry, and opening /admin shows the server's 403 message", async ({
  page,
  users,
  runtimeErrors,
}) => {
  const rita = await users.create();
  runtimeErrors.allowResponse({
    status: 403,
    method: 'GET',
    path: /^\/api\/app\/admin\/users$/,
    reason: 'a regular user opens /admin directly',
  });
  await loginAs(page, rita.account);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);

  for (const path of ['/admin', '/admin/users', '/admin/invites', '/admin/instance']) {
    const refused = page.waitForResponse(response => response.url().endsWith('/api/app/admin/users'));
    await page.goto(path);
    expect((await refused).status()).toBe(403);
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Admin access required');
    await expect(page.locator('.settings-card')).toHaveCount(0);
  }
});

test('revoking invites by keyboard keeps focus in the invites section', async ({ page, data }) => {
  for (const note of ['Invite A', 'Invite B', 'Invite C']) await data.createInvite({ role: 'user', note });
  await login(page);
  await openAdmin(page, 'Invites');
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
  const button = (email: string, action: string) =>
    userRow(page, email).getByRole('button', { name: `${action} ${email}` });

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
  await remove(sam.account.email);
  await expect(page.locator('#users').getByRole('heading', { name: 'Users' })).toBeFocused();
});

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

test('an instance setting restored to the server value follows refetches, and saving sends only edited fields', async ({
  page,
  data,
}) => {
  const before = await data.instanceSettings();
  try {
    await login(page);
    await openAdmin(page, 'Instance settings');
    const card = page.locator('#instance');
    const sessionDays = card.getByLabel('Session length (days)');
    const inviteDays = card.getByLabel('Invite link lifetime (days)');
    await expect(sessionDays).toHaveValue(String(before.session_days));

    await sessionDays.fill(String(before.session_days + 1));
    await sessionDays.fill(String(before.session_days));
    const changed = before.session_days === 60 ? 61 : 60;
    await data.saveInstanceSettings({ session_days: changed, invite_days: before.invite_days });
    // Window focus refetches stale queries, at most once a second.
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(sessionDays).toHaveValue(String(changed), { timeout: 1500 });
    }).toPass();
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('No changes to save')).toBeVisible();

    const invite = before.invite_days === 10 ? 11 : 10;
    await inviteDays.fill(String(invite));
    await data.saveInstanceSettings({ session_days: 90, invite_days: before.invite_days });
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Instance settings saved')).toBeVisible();
    expect(await data.instanceSettings()).toMatchObject({
      session_days: 90,
      invite_days: invite,
      time_resolution_minutes: before.time_resolution_minutes,
    });
    await expect(sessionDays).toHaveValue('90');
    await expect(inviteDays).toHaveValue(String(invite));
  } finally {
    await data.saveInstanceSettings(before);
  }
});

test('a value typed while a save is pending stays after the response, and Save sends it', async ({ page, data }) => {
  const before = await data.instanceSettings();
  const changed = before.session_days === 60 ? 61 : 60;
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/app/admin/settings', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) await held;
    await route.fallback();
  });
  await login(page);
  await openAdmin(page, 'Instance settings');
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

test('after a failed save, a value typed back to the server value is no longer an edit', async ({
  page,
  data,
  runtimeErrors,
}) => {
  const before = await data.instanceSettings();
  const changed = before.session_days === 60 ? 61 : 60;
  const invite = before.invite_days === 10 ? 11 : 10;
  runtimeErrors.allowResponse({
    status: 503,
    method: 'PUT',
    path: /^\/api\/app\/admin\/settings$/,
    reason: 'the held save is answered with an outage',
  });
  let sent = 0;
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/app/admin/settings', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    sent += 1;
    await held;
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Server unavailable' });
  });
  await login(page);
  await openAdmin(page, 'Instance settings');
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

  const other = before.session_days === 90 ? 91 : 90;
  await data.saveInstanceSettings({ session_days: other, invite_days: before.invite_days });
  try {
    // Window focus refetches stale queries, at most once a second.
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(sessionDays).toHaveValue(String(other), { timeout: 1500 });
    }).toPass();
    await expect(inviteDays).toHaveValue(String(invite));
  } finally {
    await data.saveInstanceSettings(before);
  }
});

for (const section of ['Users', 'Invites', 'Instance settings'] as const) {
  test(`every ${section} control is reachable by keyboard and shows a focus ring`, async ({ page, data, users }) => {
    await users.create();
    await data.createInvite({ role: 'user', note: 'Keyboard check' });
    await login(page);
    await openAdmin(page, section);
    await expect(page.locator('.settings-card')).toBeVisible();

    const total = await page.getByRole('main').evaluate(main => {
      const controls = [...main.querySelectorAll<HTMLElement>('a[href], button, select, input, textarea')].filter(
        control => !(control as HTMLButtonElement).disabled,
      );
      controls.forEach((control, index) => control.setAttribute('data-keyboard-check', String(index)));
      return controls.length;
    });
    expect(total).toBeGreaterThan(5);

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
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('a long sign-up email stays on one line inside the invite table without widening the page', async ({
    page,
    data,
  }) => {
    const email = `signup-${'a'.repeat(56)}@${'b'.repeat(63)}.${'c'.repeat(63)}.example`;
    const id = await data.createInvite({ role: 'user' });
    await mockSignupInvite(page, id, email);
    await login(page);
    const sheet = await openMore(page);
    await tap(sheet.getByRole('link', { name: 'Admin', exact: true }));
    await tap(
      page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Invites', exact: true }),
    );
    const row = inviteRow(page, email);
    await expect(row).toBeVisible();
    const cell = row.getByRole('cell', { name: email, exact: true });
    await expect(cell).toHaveAttribute('title', email);
    const size = await cell.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      height: element.parentElement!.getBoundingClientRect().height,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(size.width).toBeLessThanOrEqual(320);
    expect(size.height).toBeLessThanOrEqual(66);
    expect(size.whiteSpace).toBe('nowrap');
    await expectNoPageOverflow(page);
    await tap(row.getByRole('button', { name: `Revoke sign-up invite for ${email}`, exact: true }));
    await expect(row).toHaveCount(0);
    expect(await data.inviteList()).toEqual([]);
    await tap(
      page
        .getByRole('navigation', { name: 'Admin sections' })
        .getByRole('link', { name: 'Instance settings', exact: true }),
    );
    await expectFits(page.locator('#instance').getByRole('checkbox', { name: 'Allow email sign-up' }));
    await expectNoPageOverflow(page);
  });

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

    await tap(
      page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Invites', exact: true }),
    );
    await tap(page.locator('#invites').getByRole('button', { name: 'Create invite' }));
    await expectFits(page.getByLabel('Invite link', { exact: true }));
    await expectFits(page.getByRole('button', { name: 'Copy link' }));
    await tap(
      page
        .getByRole('navigation', { name: 'Admin sections' })
        .getByRole('link', { name: 'Instance settings', exact: true }),
    );
    await expectFits(page.locator('#instance').getByRole('button', { name: 'Save' }));
    await tap(
      page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Users', exact: true }),
    );
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
