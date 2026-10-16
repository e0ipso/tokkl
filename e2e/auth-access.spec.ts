import { request, type APIRequestContext } from '@playwright/test';
import { EMAIL, PASSWORD } from './fixtures.ts';
import {
  ACCOUNT, basic, createAccount, expect, logInThroughForm, meWithBasic, meWithSession, sessionCookie, test,
} from './auth-tests-helpers.ts';

// Who may reach what. The e2e server has a single account, so only its own workspace exists and
// it is the only admin: these scenarios cover what one account can see of the wave 3 access rules.

const NO_ACCESS = 'User does not have access to this resource.';

async function withBasic<T>(baseURL: string, authorization: string, run: (api: APIRequestContext) => Promise<T>): Promise<T> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { authorization } });
  try {
    return await run(api);
  } finally {
    await api.dispose();
  }
}

// TT-0135: every workspace route resolves the workspace through its membership, and a workspace the
// caller is not in, existing or not, answers the same 403. PUT /me refuses it as the default.
test('a workspace the account does not belong to is refused on every route and as the default', async ({ data, baseURL }) => {
  const other = data.workspaceId + 1000;
  await withBasic(baseURL!, basic(EMAIL, PASSWORD), async (api) => {
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

  await withBasic(server.baseURL, basic(apiToken, 'api_token'), async (api) => {
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
  await withBasic(server.baseURL, basic(apiToken, 'api_token'), async (api) => {
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
