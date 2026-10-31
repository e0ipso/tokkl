import type { Kysely, Selectable } from 'kysely';
import type { Backend } from '../config.ts';
import type { AccountChanges, NewAccount, Repositories } from '../contracts.ts';
import type { AccountToken, InstanceSettings, MembershipRole, User, UserRole, Workspace } from '../domain.ts';
import type { AccountTokensRow, PhysicalDatabase, UsersRow, WorkspacesRow } from '../physical.ts';
import { entityId, finiteNumber, jsonObject, safeInteger, utcInstant } from '../conversion.ts';

export type AccountRepositories = Pick<Repositories, 'users' | 'workspaces' | 'settings' | 'tokens' | 'sessions'>;
function role(value: string): UserRole {
  if (value !== 'admin' && value !== 'user') throw new Error('Invalid storage account role');
  return value;
}
function membershipRole(value: string): MembershipRole {
  if (value !== 'owner' && value !== 'member') throw new Error('Invalid storage membership role');
  return value;
}
const nullableInstant = (value: string | null) => value === null ? null : utcInstant(value);
function user(row: Selectable<UsersRow>): User {
  return {
    id: entityId(row.id), email: row.email, fullName: row.fullname, passwordHash: row.password_hash,
    apiToken: row.api_token, timezone: row.timezone, beginningOfWeek: safeInteger(row.beginning_of_week),
    defaultWorkspaceId: entityId(row.default_workspace_id), preferences: jsonObject(row.preferences), role: role(row.role),
    disabledAt: nullableInstant(row.disabled_at), createdAt: utcInstant(row.created_at), updatedAt: utcInstant(row.updated_at),
  };
}
function workspace(row: Selectable<WorkspacesRow>): Workspace {
  return {
    id: entityId(row.id), name: row.name, defaultCurrency: row.default_currency,
    defaultHourlyRate: row.default_hourly_rate === null ? null : finiteNumber(row.default_hourly_rate),
    rounding: safeInteger(row.rounding), roundingMinutes: safeInteger(row.rounding_minutes),
    createdAt: utcInstant(row.created_at), updatedAt: utcInstant(row.updated_at),
  };
}
function accountToken(row: Selectable<AccountTokensRow>): AccountToken {
  if (row.kind !== 'invite' && row.kind !== 'password_reset') throw new Error('Invalid storage token kind');
  return {
    id: entityId(row.id), tokenHash: row.token_hash, kind: row.kind, role: row.role === null ? null : role(row.role),
    note: row.note, userId: row.user_id === null ? null : entityId(row.user_id),
    createdBy: row.created_by === null ? null : entityId(row.created_by), createdAt: utcInstant(row.created_at),
    expiresAt: utcInstant(row.expires_at), usedAt: nullableInstant(row.used_at),
  };
}
const settingKeys = { sessionDays: 'session_days', inviteDays: 'invite_days', timeResolutionMinutes: 'time_resolution_minutes' } as const;

/** Every query uses the operation's supplied checkout. Construct only inside the runner's factory. */
export function createAccountRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): AccountRepositories {
  const now = () => new Date().toISOString();
  const generatedId = async (query: { executeTakeFirstOrThrow(): Promise<{ insertId?: bigint }> }) => {
    return entityId((await query.executeTakeFirstOrThrow()).insertId);
  };
  const getUser = async (id: number) => {
    const row = await db.selectFrom('users').selectAll().where('id', '=', entityId(id)).executeTakeFirst();
    return row ? user(row) : undefined;
  };
  const getWorkspace = async (id: number) => {
    const row = await db.selectFrom('workspaces').selectAll().where('id', '=', entityId(id)).executeTakeFirst();
    return row ? workspace(row) : undefined;
  };
  const workspaces: AccountRepositories['workspaces'] = {
    get: getWorkspace,
    async forMember(userId, workspaceId) {
      const row = await db.selectFrom('workspaces').innerJoin('workspace_users', 'workspace_users.workspace_id', 'workspaces.id')
        .selectAll('workspaces').where('workspace_users.user_id', '=', entityId(userId)).where('workspaces.id', '=', entityId(workspaceId)).executeTakeFirst();
      return row ? workspace(row) : undefined;
    },
    async listForUser(userId) {
      return (await db.selectFrom('workspaces').innerJoin('workspace_users', 'workspace_users.workspace_id', 'workspaces.id')
        .selectAll('workspaces').where('workspace_users.user_id', '=', entityId(userId)).orderBy('workspaces.id').execute()).map(workspace);
    },
    async create(name) {
      const at = now();
      const query = db.insertInto('workspaces').values({ name, created_at: at, updated_at: at, default_hourly_rate: null });
      const id = backend === 'postgres' ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id) : await generatedId(query);
      return (await getWorkspace(id))!;
    },
    async update(id, changes) {
      await db.updateTable('workspaces').set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.defaultCurrency === undefined ? {} : { default_currency: changes.defaultCurrency }),
        ...(changes.defaultHourlyRate === undefined ? {} : { default_hourly_rate: changes.defaultHourlyRate }),
        ...(changes.rounding === undefined ? {} : { rounding: changes.rounding }),
        ...(changes.roundingMinutes === undefined ? {} : { rounding_minutes: changes.roundingMinutes }), updated_at: now(),
      }).where('id', '=', entityId(id)).execute();
      return (await getWorkspace(id))!;
    },
    async getRole(userId, workspaceId) {
      const row = await db.selectFrom('workspace_users').select('role').where('user_id', '=', entityId(userId)).where('workspace_id', '=', entityId(workspaceId)).executeTakeFirst();
      return row ? membershipRole(row.role) : undefined;
    },
    async addMember(input) {
      await db.insertInto('workspace_users').values({ workspace_id: entityId(input.workspaceId), user_id: entityId(input.userId), role: input.role }).execute();
    },
    async countMembers(workspaceId) {
      return safeInteger((await db.selectFrom('workspace_users').select(db.fn.countAll().as('n')).where('workspace_id', '=', entityId(workspaceId)).executeTakeFirstOrThrow()).n);
    },
    async listMembers(workspaceId) {
      return (await db.selectFrom('workspace_users').innerJoin('users', 'users.id', 'workspace_users.user_id')
        .select(['users.id', 'users.email', 'users.fullname', 'users.timezone', 'workspace_users.role'])
        .where('workspace_id', '=', entityId(workspaceId)).orderBy('users.id').execute()).map(row => ({
          userId: entityId(row.id), workspaceId: entityId(workspaceId), email: row.email, fullName: row.fullname, timezone: row.timezone, role: membershipRole(row.role),
        }));
    },
    async deleteSoleMemberWorkspaces(userId) {
      // The caller holds the instance and all the user's workspace guards before these predicates.
      for (const ws of await workspaces.listForUser(userId)) {
        if (await workspaces.countMembers(ws.id) === 1) await db.deleteFrom('workspaces').where('id', '=', ws.id).execute();
      }
    },
  };
  const users: AccountRepositories['users'] = {
    async count() { return safeInteger((await db.selectFrom('users').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n); },
    async countActiveAdmins() { return safeInteger((await db.selectFrom('users').select(db.fn.countAll().as('n')).where('role', '=', 'admin').where('disabled_at', 'is', null).executeTakeFirstOrThrow()).n); },
    get: getUser,
    async findByEmail(email) {
      const folded = email.replace(/[A-Z]/g, c => c.toLowerCase());
      const key = backend === 'mysql' || backend === 'mariadb' ? Buffer.from(folded) : folded;
      const row = await db.selectFrom('users').selectAll().where('email_key', '=', key).executeTakeFirst();
      return row ? user(row) : undefined;
    },
    async findByApiToken(token) {
      const row = await db.selectFrom('users').selectAll().where('api_token', '=', token).executeTakeFirst();
      return row ? user(row) : undefined;
    },
    async list() { return (await db.selectFrom('users').selectAll().orderBy('id').execute()).map(user); },
    async createAccount(input: NewAccount) {
      const ws = await workspaces.create(`${input.fullName || 'My'} workspace`.trim());
      const at = now();
      const query = db.insertInto('users').values({ email: input.email, fullname: input.fullName, password_hash: input.passwordHash,
        api_token: input.apiToken, timezone: input.timezone, default_workspace_id: ws.id, preferences: JSON.stringify(jsonObject(input.preferences)),
        role: input.role, disabled_at: null, created_at: at, updated_at: at });
      const id = backend === 'postgres' ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id) : await generatedId(query);
      await workspaces.addMember({ workspaceId: ws.id, userId: id, role: 'owner' });
      return (await getUser(id))!;
    },
    async updateAccount(id, changes: AccountChanges) {
      await db.updateTable('users').set({
        ...(changes.email === undefined ? {} : { email: changes.email }), ...(changes.fullName === undefined ? {} : { fullname: changes.fullName }),
        ...(changes.timezone === undefined ? {} : { timezone: changes.timezone }),
        ...(changes.beginningOfWeek === undefined ? {} : { beginning_of_week: changes.beginningOfWeek }),
        ...(changes.defaultWorkspaceId === undefined ? {} : { default_workspace_id: entityId(changes.defaultWorkspaceId) }), updated_at: now(),
      }).where('id', '=', entityId(id)).execute();
      return (await getUser(id))!;
    },
    async setPreferences(id, preferences) { await db.updateTable('users').set({ preferences: JSON.stringify(jsonObject(preferences)), updated_at: now() }).where('id', '=', entityId(id)).execute(); },
    async changeCredentials(id, expectedPasswordHash, passwordHash, apiToken) {
      return (await db.updateTable('users').set({ password_hash: passwordHash, api_token: apiToken, updated_at: now() })
        .where('id', '=', entityId(id)).where('password_hash', '=', expectedPasswordHash).where('disabled_at', 'is', null).executeTakeFirstOrThrow()).numUpdatedRows === 1n;
    },
    async rotateApiToken(id, apiToken) { await db.updateTable('users').set({ api_token: apiToken, updated_at: now() }).where('id', '=', entityId(id)).execute(); },
    async setAccess(id, accessRole, disabledAt) {
      await db.updateTable('users').set({ role: accessRole, disabled_at: disabledAt, updated_at: now() }).where('id', '=', entityId(id)).execute();
      return (await getUser(id))!;
    },
    async delete(id) { await db.deleteFrom('users').where('id', '=', entityId(id)).execute(); },
  };
  return {
    users, workspaces,
    settings: {
      async read() {
        const values: Partial<InstanceSettings> = {};
        for (const row of await db.selectFrom('instance_settings').select(['key', 'value']).execute()) {
          const key = (Object.keys(settingKeys) as Array<keyof InstanceSettings>).find(k => settingKeys[k] === row.key);
          if (key) { try { const value: unknown = JSON.parse(row.value); if (typeof value === 'number') values[key] = value; } catch { /* Domain applies defaults. */ } }
        }
        return values;
      },
      async write(changes) {
        for (const change of changes) {
          const values = { key: settingKeys[change.key], value: JSON.stringify(change.value), updated_at: utcInstant(change.updatedAt), updated_by: change.updatedBy };
          const query = db.insertInto('instance_settings').values(values);
          if (backend === 'mysql' || backend === 'mariadb') await query.onDuplicateKeyUpdate(values).execute();
          else await query.onConflict(oc => oc.column('key').doUpdateSet(values)).execute();
        }
      },
    },
    tokens: {
      async create(input) {
        const query = db.insertInto('account_tokens').values({ token_hash: input.tokenHash, kind: input.kind, role: input.role,
          note: input.note, user_id: input.userId, created_by: input.createdBy, created_at: utcInstant(input.createdAt),
          expires_at: utcInstant(input.expiresAt), used_at: nullableInstant(input.usedAt) });
        const id = backend === 'postgres' ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id) : await generatedId(query);
        return accountToken(await db.selectFrom('account_tokens').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
      },
      async listPendingInvites(at) { return (await db.selectFrom('account_tokens').selectAll().where('kind', '=', 'invite').where('used_at', 'is', null).where('expires_at', '>', utcInstant(at)).orderBy('id').execute()).map(accountToken); },
      async findUsable(hash, kind, at) {
        const row = await db.selectFrom('account_tokens').selectAll().where('token_hash', '=', hash).where('kind', '=', kind).where('used_at', 'is', null).where('expires_at', '>', utcInstant(at)).executeTakeFirst();
        return row ? accountToken(row) : undefined;
      },
      async consume(id, at, userId) {
        return (await db.updateTable('account_tokens').set({ used_at: utcInstant(at), ...(userId === undefined ? {} : { user_id: entityId(userId) }) }).where('id', '=', entityId(id)).where('used_at', 'is', null).where('expires_at', '>', utcInstant(at)).executeTakeFirstOrThrow()).numUpdatedRows === 1n;
      },
      async revokeInvite(id) { return (await db.deleteFrom('account_tokens').where('id', '=', entityId(id)).where('kind', '=', 'invite').where('used_at', 'is', null).executeTakeFirstOrThrow()).numDeletedRows > 0n; },
      async revokeInvitesCreatedBy(id) { await db.deleteFrom('account_tokens').where('created_by', '=', entityId(id)).where('kind', '=', 'invite').where('used_at', 'is', null).execute(); },
      async revokeUnusedPasswordResets(id) { await db.deleteFrom('account_tokens').where('user_id', '=', entityId(id)).where('kind', '=', 'password_reset').where('used_at', 'is', null).execute(); },
    },
    sessions: {
      async create(input) { await db.insertInto('sessions').values({ token_hash: input.tokenHash, user_id: entityId(input.userId), created_at: utcInstant(input.createdAt), expires_at: utcInstant(input.expiresAt), user_agent: input.userAgent.slice(0, 255) }).execute(); },
      async find(hash) {
        const row = await db.selectFrom('sessions').selectAll().where('token_hash', '=', hash).executeTakeFirst();
        return row ? { tokenHash: row.token_hash, userId: entityId(row.user_id), createdAt: utcInstant(row.created_at), expiresAt: utcInstant(row.expires_at), userAgent: row.user_agent } : undefined;
      },
      async delete(hash) { await db.deleteFrom('sessions').where('token_hash', '=', hash).execute(); },
      async deleteForUser(id, keep) {
        let query = db.deleteFrom('sessions').where('user_id', '=', entityId(id));
        if (keep !== undefined) query = query.where('token_hash', '!=', keep);
        await query.execute();
      },
      async deleteExpired(at) { return safeInteger((await db.deleteFrom('sessions').where('expires_at', '<', utcInstant(at)).executeTakeFirstOrThrow()).numDeletedRows); },
    },
  };
}
