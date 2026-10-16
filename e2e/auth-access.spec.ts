import { request, type APIRequestContext } from '@playwright/test';
import { EMAIL, PASSWORD } from './fixtures.ts';
import {
  ACCOUNT, acceptInvite, basic, createAccount, createInvite, expect, inviteApiPath, logInThroughForm, meWithBasic,
  meWithSession, sessionCookie, test, withAuth,
} from './auth-tests-helpers.ts';

// Who may reach what. The shared e2e server has a single account, the only admin. Scenarios that
// need a second account start a disposable server and add it through an invite.

const NO_ACCESS = 'User does not have access to this resource.';

// TT-0135: every workspace route resolves the workspace through its membership, and a workspace the
// caller is not in, existing or not, answers the same 403. PUT /me refuses it as the default.
test('a workspace the account does not belong to is refused on every route and as the default', async ({ data, baseURL }) => {
  const other = data.workspaceId + 1000;
  await withAuth(baseURL!, basic(EMAIL, PASSWORD), async (api) => {
    const refusals = [
      await api.get(`/api/v9/workspaces/${other}`),
      await api.get(`/api/v9/workspaces/${other}/projects`),
      await api.post(`/api/v9/workspaces/${other}/time_entries`, {
        data: { description: 'Elsewhere', start: '2026-01-05T09:00:00Z', duration: 3600, created_with: 'e2e' },
      }),
      await api.post(`/reports/api/v3/workspace/${other}/search/time_entries`, { data: { start_date: '2026-01-01', end_date: '2026-01-31' } }),
    ];
    for (const response of refusals) {
      expect(response.status(), response.url()).toBe(403);
      expect(await response.json(), response.url()).toBe(NO_ACCESS);
    }

    const put = await api.put('/api/v9/me', { data: { default_workspace_id: other } });
    expect(put.status()).toBe(400);
    expect(await put.json()).toBe('Invalid default_workspace_id');
    expect((await (await api.get('/api/v9/me')).json()).default_workspace_id).toBe(data.workspaceId);
    expect((await api.get(`/api/v9/workspaces/${data.workspaceId}`)).status()).toBe(200);
  });
});

// TT-0137: the admin API is for signed-in active admins, and the last active admin cannot be
// demoted or disabled.
test('the admin API lists the account and keeps the last active admin', async ({ servers }) => {
  const server = await servers.start({ slot: 5 });
  const { apiToken } = await createAccount(server.baseURL);

  const anonymous = await request.newContext({ baseURL: server.baseURL });
  try {
    expect((await anonymous.get('/api/app/admin/users')).status()).toBe(403);
  } finally {
    await anonymous.dispose();
  }

  await withAuth(server.baseURL, basic(apiToken, 'api_token'), async (api) => {
    const listAccounts = async () => (await api.get('/api/app/admin/users')).json();
    const accounts = await listAccounts();
    expect(accounts).toEqual([{
      id: expect.any(Number), email: ACCOUNT.email, fullname: ACCOUNT.fullname, role: 'admin',
      created_at: expect.any(String), disabled_at: null,
    }]);
    const { id } = accounts[0];

    for (const change of [{ role: 'user' }, { disabled: true }]) {
      const refused = await api.patch(`/api/app/admin/users/${id}`, { data: change });
      expect(refused.status(), JSON.stringify(change)).toBe(400);
      expect(await refused.json()).toBe('At least one active admin must remain');
    }
    expect(await listAccounts()).toEqual(accounts);
  });
  expect(await meWithBasic(server.baseURL, basic(ACCOUNT.email, ACCOUNT.password))).toBe(200);
});

// TT-0137: revoking an account's sessions signs every browser out, the admin's own included, and
// leaves its API token working.
test('revoking sessions logs every browser out and keeps the API token', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 5 });
  const { apiToken } = await createAccount(server.baseURL);
  await logInThroughForm(page, server.baseURL);
  const session = await sessionCookie(page, server.baseURL);
  expect(await meWithSession(server.baseURL, session)).toBe(200);

  runtimeErrors.allowResponse({
    status: 403, method: 'GET', path: /^\/api\/v9\/me(\/|$)/,
    reason: 'the browser still sends the session cookie the admin revoked',
  });
  await withAuth(server.baseURL, basic(apiToken, 'api_token'), async (api) => {
    const [{ id }] = await (await api.get('/api/app/admin/users')).json();
    const revoke = await api.post(`/api/app/admin/users/${id}/sessions/revoke`);
    expect(revoke.status()).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true });
  });

  expect(await meWithSession(server.baseURL, session)).toBe(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await meWithBasic(server.baseURL, basic(apiToken, 'api_token'))).toBe(200);
});

interface Account { id: number; email: string }

async function accountId(api: APIRequestContext, email: string): Promise<number> {
  const accounts = await (await api.get('/api/app/admin/users')).json() as Account[];
  return accounts.find((account) => account.email === email)!.id;
}

// TT-0140: deleting an account, confirmed by its email, removes it with its private workspace and
// signs its browser out. The email is then free for a new, empty account.
test('deleting an invited account signs it out everywhere and frees its email', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 5 });
  const { apiToken } = await createAccount(server.baseURL);
  const admin = basic(apiToken, 'api_token');
  const member = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'user'), 'member@auth.example');
  const memberApi = basic(member.apiToken, 'api_token');
  const adminId = await withAuth(server.baseURL, admin, (api) => accountId(api, ACCOUNT.email));
  await withAuth(server.baseURL, memberApi, async (api) => {
    const entry = await api.post(`/api/v9/workspaces/${member.workspaceId}/time_entries`, {
      data: { description: 'Member work', start: '2026-01-05T09:00:00Z', duration: 3600, created_with: 'e2e' },
    });
    expect(entry.status()).toBe(200);
    expect((await api.delete(`/api/app/admin/users/${adminId}`, { data: { email: ACCOUNT.email } })).status()).toBe(403);
  });

  await page.context().addCookies([{ name: 'tokkl_session', value: member.session, url: server.baseURL }]);
  await page.goto(server.baseURL);
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  runtimeErrors.allowResponse({
    status: 403, method: 'GET', path: /^\/api\/v9\/me(\/|$)/,
    reason: 'the browser still sends the session cookie of the deleted account',
  });

  await withAuth(server.baseURL, admin, async (api) => {
    const id = await accountId(api, member.email);
    const wrong = await api.delete(`/api/app/admin/users/${id}`, { data: { email: ACCOUNT.email } });
    expect(wrong.status()).toBe(400);
    expect(await wrong.json()).toBe("Enter the account's email to confirm the deletion");
    expect(await meWithSession(server.baseURL, member.session)).toBe(200);

    const deleted = await api.delete(`/api/app/admin/users/${id}`, { data: { email: member.email.toUpperCase() } });
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect((await (await api.get('/api/app/admin/users')).json() as Account[]).map((a) => a.email)).toEqual([ACCOUNT.email]);
    expect((await api.delete(`/api/app/admin/users/${id}`, { data: { email: member.email } })).status()).toBe(404);
  });

  expect(await meWithSession(server.baseURL, member.session)).toBe(403);
  expect(await meWithBasic(server.baseURL, memberApi)).toBe(403);
  expect(await meWithBasic(server.baseURL, basic(member.email, member.password))).toBe(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // The same email can be invited again and starts with an empty workspace.
  const again = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'user'), member.email);
  await withAuth(server.baseURL, basic(again.apiToken, 'api_token'), async (api) => {
    expect(await (await api.get('/api/v9/me/time_entries')).json()).toEqual([]);
  });
});

// TT-0140: an admin cannot delete themselves or the last active admin. Deleting an admin also kills
// the invite links they created.
test('admins cannot delete themselves or the last admin, and a deleted admin\'s invites stop working', async ({ servers }) => {
  const server = await servers.start({ slot: 5 });
  const { apiToken } = await createAccount(server.baseURL);
  const admin = basic(apiToken, 'api_token');
  await withAuth(server.baseURL, admin, async (api) => {
    const ownId = await accountId(api, ACCOUNT.email);
    const lastAdmin = await api.delete(`/api/app/admin/users/${ownId}`, { data: { email: ACCOUNT.email } });
    expect(lastAdmin.status()).toBe(400);
    expect(await lastAdmin.json()).toBe('At least one active admin must remain');

    const second = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'admin'), 'second@auth.example');
    const secondInvite = await createInvite(server.baseURL, second.apiToken, 'user');
    const self = await api.delete(`/api/app/admin/users/${ownId}`, { data: { email: ACCOUNT.email } });
    expect(self.status()).toBe(400);
    expect(await self.json()).toBe('You cannot delete your own account');

    expect(await (await api.get('/api/app/admin/invites')).json()).toHaveLength(1);
    const secondId = await accountId(api, second.email);
    expect((await api.delete(`/api/app/admin/users/${secondId}`, { data: { email: second.email } })).status()).toBe(200);
    expect(await (await api.get('/api/app/admin/invites')).json()).toEqual([]);
    expect((await api.get(inviteApiPath(secondInvite))).status()).toBe(404);
  });
  expect(await meWithBasic(server.baseURL, admin)).toBe(200);
});
