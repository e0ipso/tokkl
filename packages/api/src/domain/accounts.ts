import type { AccountChanges, OperationContext, Repositories } from '../storage/contracts.ts';
import type { Id, InstanceSettings, JsonObject, User, UserRole, Workspace } from '../storage/domain.ts';
import { StorageConflict } from '../storage/errors.ts';
import { badRequest, forbidden, notFound, tooManyRequests } from '../lib/errors.ts';
import { optionalBool, optionalRate, optionalString } from '../lib/values.ts';
import { generateApiToken, generateSessionToken, hashPassword, readNewPassword, sha256, verifyPassword } from '../auth/crypto.ts';
import { normalizeEmail } from '../auth/rateLimit.ts';
import { DEFAULT_PREFERENCES, getPreferences, readNewAccount, readProfileChanges, validatePreferenceChanges } from './accountValues.ts';

export type AccountRepositories = Pick<Repositories, 'users' | 'workspaces' | 'settings' | 'tokens' | 'sessions'>;
export type AccountContext = OperationContext<AccountRepositories>;
export interface AccountRunner<R extends AccountRepositories = AccountRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
export type AccountCredential = { kind: 'session'; token: string } | { kind: 'api-token'; token: string } | { kind: 'password' };
/** The HTTP/auth adapter supplies FailureLimiter.attempt with passwordCounters and its address. */
export interface AccountPasswordAttempt {
  attempt(check: () => Promise<boolean>): Promise<boolean | null>;
  retryAfterSeconds(): number;
}
/** Required at operations that need entry/timer work. Implement with the same operation context. */
export interface AccountEntryEffects<R extends AccountRepositories = AccountRepositories> {
  reanchorTimezone(context: OperationContext<R>, userId: Id, oldTimezone: string, newTimezone: string): Promise<void>;
  /** Discover timer owners under workspace guards, before acquiring the complete sorted user set. */
  affectedDeletionUsers(context: OperationContext<R>, userId: Id, workspaces: Workspace[]): Promise<Id[]>;
  beforeDelete(context: OperationContext<R>, user: User, soleWorkspaces: Workspace[]): Promise<void>;
}
/** Application composition supplies local stream credential rechecks. Called after confirmed commit. */
export interface AccountSecurityEffects { recheckUser(userId: Id): Promise<void> }
export const NO_WORKSPACE_ACCESS = 'User does not have access to this resource.';
export const INVITE_NOT_FOUND = 'This invite link is not valid. Ask your admin for a new one.';
export const RESET_NOT_FOUND = 'This password reset link is not valid. Ask your admin for a new one.';
export const PASSWORD_RESET_HOURS = 24;
export const MAX_INVITE_NOTE_LENGTH = 255;
const now = () => new Date().toISOString();
export const isActiveUser = (user: User | undefined): user is User => !!user && user.disabledAt === null;
const active = isActiveUser;
export const isActiveAdmin = (user: User) => active(user) && user.role === 'admin';
const activeAdmin = isActiveAdmin;
const refused = () => forbidden('Incorrect username and/or password');

export async function memberWorkspace(ctx: AccountRepositories, userId: Id, workspaceId: Id): Promise<Workspace> {
  const ws = await ctx.workspaces.forMember(userId, workspaceId);
  if (!ws) throw forbidden(NO_WORKSPACE_ACCESS);
  return ws;
}
export async function findUsableInvite(ctx: AccountRepositories, token: string) {
  return ctx.tokens.findUsable(sha256(token), 'invite', now());
}
export async function findResetUser(ctx: AccountRepositories, token: string): Promise<User | undefined> {
  const reset = await ctx.tokens.findUsable(sha256(token), 'password_reset', now());
  const user = reset?.userId ? await ctx.users.get(reset.userId) : undefined;
  return active(user) ? user : undefined;
}
async function lockExistingUser(ctx: AccountContext, id: Id): Promise<User> {
  // Instance guard precedes discovery, so an account deletion cannot remove this parent meanwhile.
  if (!await ctx.users.get(id)) throw notFound('User not found');
  await ctx.lockUsers([id]);
  return (await ctx.users.get(id))!;
}
async function requireAdmin(ctx: AccountContext, id: Id) {
  const actor = await ctx.users.get(id);
  if (!actor || !activeAdmin(actor)) throw forbidden('Admin access required');
}
async function currentSignedIn(ctx: AccountRepositories, seen: User, credential: AccountCredential): Promise<User | undefined> {
  const current = await ctx.users.get(seen.id);
  if (!active(current) || current.passwordHash !== seen.passwordHash) return;
  if (credential.kind === 'api-token' && current.apiToken !== credential.token) return;
  if (credential.kind === 'session') {
    const session = await ctx.sessions.find(sha256(credential.token));
    if (!session || session.userId !== current.id || session.expiresAt < now()) return;
  }
  return current;
}
async function accountInput(input: Record<string, unknown>, role: UserRole) {
  const account = readNewAccount(input);
  return { email: account.email, fullName: account.fullname, timezone: account.timezone,
    passwordHash: await hashPassword(account.password), apiToken: generateApiToken(), role,
    preferences: { ...DEFAULT_PREFERENCES, pg_time_zone_name: account.timezone } };
}
async function emailConflict<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof StorageConflict && error.kind === 'unique') throw badRequest(message); throw error; }
}
const resolutions = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];
const settingNames = { session_days: 'sessionDays', invite_days: 'inviteDays', time_resolution_minutes: 'timeResolutionMinutes' } as const;
function validSetting(key: keyof InstanceSettings, value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (key === 'timeResolutionMinutes' ? resolutions.includes(value) : value >= 1 && value <= (key === 'sessionDays' ? 365 : 90));
}
export function readSettingChanges(body: Record<string, unknown>): Partial<InstanceSettings> {
  const changes: Partial<InstanceSettings> = {};
  for (const [name, value] of Object.entries(body)) {
    if (!Object.hasOwn(settingNames, name)) throw badRequest(`Unknown setting: ${name}`);
    const key = settingNames[name as keyof typeof settingNames];
    if (!validSetting(key, value)) throw badRequest(`Invalid ${name}: expected ${key === 'timeResolutionMinutes' ? `one of ${resolutions.join(', ')}` : `an integer from 1 to ${key === 'sessionDays' ? 365 : 90}`}`);
    changes[key] = value;
  }
  if (!Object.keys(changes).length) throw badRequest('Expected session_days or invite_days or time_resolution_minutes');
  return changes;
}
export async function getInstanceSettings(ctx: AccountRepositories, sessionDays: number): Promise<InstanceSettings> {
  const stored = await ctx.settings.read();
  return { sessionDays: validSetting('sessionDays', stored.sessionDays) ? stored.sessionDays : sessionDays,
    inviteDays: validSetting('inviteDays', stored.inviteDays) ? stored.inviteDays : 7,
    timeResolutionMinutes: validSetting('timeResolutionMinutes', stored.timeResolutionMinutes) ? stored.timeResolutionMinutes : 5 };
}
export function serializeSettings(settings: InstanceSettings) {
  return { session_days: settings.sessionDays, invite_days: settings.inviteDays, time_resolution_minutes: settings.timeResolutionMinutes };
}

export function createAccountOperations<R extends AccountRepositories>(runner: AccountRunner<R>, security: AccountSecurityEffects) {
  return {
    async createFirstAdmin(input: Record<string, unknown>): Promise<User> {
      const account = await accountInput(input, 'admin');
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (await ctx.users.count() > 0) throw forbidden('Setup has already been completed');
        return ctx.users.createAccount(account);
      });
    },
    async createInvite(actorId: Id, input: { role: unknown; note?: unknown }, deploymentSessionDays: number) {
      if (input.role !== 'admin' && input.role !== 'user') throw badRequest('Invalid role: expected admin or user');
      const role = input.role;
      const note = optionalString(input.note, 'note', MAX_INVITE_NOTE_LENGTH)?.trim() || null;
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        const at = now(), settings = await getInstanceSettings(ctx, deploymentSessionDays);
        const invite = await ctx.tokens.create({ tokenHash: sha256(token), kind: 'invite', role, note, userId: null,
          createdBy: actorId, createdAt: at, expiresAt: new Date(Date.parse(at) + settings.inviteDays * 86400000).toISOString(), usedAt: null });
        return { token, invite };
      });
    },
    async acceptInvite(token: string, input: Record<string, unknown>): Promise<User> {
      // Preserve the public link error before expensive password work, then check again under guards.
      const usable = await runner.readSnapshot(ctx => ctx.tokens.findUsable(sha256(token), 'invite', now()));
      if (!usable?.role) throw notFound(INVITE_NOT_FOUND);
      const account = await accountInput(input, usable.role);
      return emailConflict(() => runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        const invite = await ctx.tokens.findUsable(sha256(token), 'invite', now());
        if (!invite?.role) throw notFound(INVITE_NOT_FOUND);
        if (await ctx.users.findByEmail(account.email)) throw badRequest('An account with this email already exists');
        const user = await ctx.users.createAccount({ ...account, role: invite.role });
        if (!await ctx.tokens.consume(invite.id, now(), user.id)) throw notFound(INVITE_NOT_FOUND);
        return user;
      }), 'An account with this email already exists');
    },
    async revokeInvite(actorId: Id, id: Id): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        if (!await ctx.tokens.revokeInvite(id)) throw notFound('Invite not found');
      });
    },
    async createPasswordReset(actorId: Id, userId: Id) {
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        if (!active(user)) throw badRequest('Enable the account before resetting its password');
        await ctx.tokens.revokeUnusedPasswordResets(userId);
        const at = now();
        const reset = await ctx.tokens.create({ tokenHash: sha256(token), kind: 'password_reset', role: null, note: null,
          userId, createdBy: actorId, createdAt: at, expiresAt: new Date(Date.parse(at) + PASSWORD_RESET_HOURS * 3600000).toISOString(), usedAt: null });
        return { token, reset };
      });
    },
    async resetPassword(token: string, password: unknown): Promise<User> {
      const hash = sha256(token);
      const candidate = await runner.readSnapshot(async ctx => {
        const reset = await ctx.tokens.findUsable(hash, 'password_reset', now());
        return reset?.userId ? ctx.users.get(reset.userId) : undefined;
      });
      if (!active(candidate)) throw notFound(RESET_NOT_FOUND);
      const passwordHash = await hashPassword(readNewPassword(password));
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.users.get(candidate.id)) throw notFound(RESET_NOT_FOUND);
        await ctx.lockUsers([candidate.id]);
        const user = await ctx.users.get(candidate.id);
        const reset = await ctx.tokens.findUsable(hash, 'password_reset', now());
        if (!active(user) || !reset || reset.userId !== user.id || !await ctx.tokens.consume(reset.id, now())) throw notFound(RESET_NOT_FOUND);
        if (!await ctx.users.changeCredentials(user.id, user.passwordHash, passwordHash, generateApiToken())) throw notFound(RESET_NOT_FOUND);
        await ctx.sessions.deleteForUser(user.id);
        ctx.afterCommit(() => security.recheckUser(user.id));
        return (await ctx.users.get(user.id))!;
      });
    },
    async setAccess(actorId: Id, userId: Id, body: Record<string, unknown>): Promise<User> {
      if (body.role !== undefined && body.role !== 'admin' && body.role !== 'user') throw badRequest('Invalid role: expected admin or user');
      const roleChange = body.role;
      const disabled = optionalBool(body.disabled, 'disabled');
      if (roleChange === undefined && disabled === undefined) throw badRequest('Expected role or disabled');
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        const role = roleChange ?? user.role;
        const disabledAt = disabled === undefined ? user.disabledAt : disabled ? user.disabledAt ?? now() : null;
        if (activeAdmin(user) && (role !== 'admin' || disabledAt !== null) && await ctx.users.countActiveAdmins() <= 1) throw badRequest('At least one active admin must remain');
        const updated = await ctx.users.setAccess(userId, role, disabledAt);
        if (disabled) await ctx.sessions.deleteForUser(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
        return updated;
      });
    },
    async deleteAccount(actorId: Id, userId: Id, email: unknown, effects: AccountEntryEffects<R>): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        if (!await ctx.users.get(userId)) throw notFound('User not found');
        const workspaces = await ctx.workspaces.listForUser(userId);
        await ctx.lockWorkspaces(workspaces.map(w => w.id));
        const members = (await Promise.all(workspaces.map(ws => ctx.workspaces.listMembers(ws.id)))).flat();
        const affectedUsers = await effects.affectedDeletionUsers(ctx, userId, workspaces);
        await ctx.lockUsers([...members.map(m => m.userId), ...affectedUsers, userId]);
        const user = (await ctx.users.get(userId))!;
        if (typeof email !== 'string' || normalizeEmail(email) !== normalizeEmail(user.email)) throw badRequest("Enter the account's email to confirm the deletion");
        if (activeAdmin(user) && await ctx.users.countActiveAdmins() <= 1) throw badRequest('At least one active admin must remain');
        if (actorId === userId) throw badRequest('You cannot delete your own account');
        const sole = [];
        for (const ws of workspaces) if (await ctx.workspaces.countMembers(ws.id) === 1) sole.push(ws);
        await effects.beforeDelete(ctx, user, sole);
        await ctx.workspaces.deleteSoleMemberWorkspaces(userId);
        await ctx.tokens.revokeInvitesCreatedBy(userId);
        await ctx.users.delete(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
      });
    },
    async addWorkspaceMember(actorId: Id, workspaceId: Id, userId: Id, role: 'owner' | 'member'): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.workspaces.get(workspaceId)) throw forbidden(NO_WORKSPACE_ACCESS);
        await ctx.lockWorkspaces([workspaceId]);
        if (!await ctx.users.get(userId)) throw notFound('User not found');
        if (!active(await ctx.users.get(actorId))) throw forbidden(NO_WORKSPACE_ACCESS);
        await ctx.lockUsers([actorId, userId]);
        if (!active(await ctx.users.get(actorId)) || await ctx.workspaces.getRole(actorId, workspaceId) !== 'owner') throw forbidden(NO_WORKSPACE_ACCESS);
        await ctx.workspaces.addMember({ workspaceId, userId, role });
      });
    },
    async updateWorkspace(userId: Id, workspaceId: Id, body: Record<string, unknown>): Promise<Workspace> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.workspaces.get(workspaceId)) throw forbidden(NO_WORKSPACE_ACCESS);
        await ctx.lockWorkspaces([workspaceId]);
        if (!active(await ctx.users.get(userId))) throw refused();
        const ws = await memberWorkspace(ctx, userId, workspaceId);
        const name = optionalString(body.name, 'name', 140)?.trim() || ws.name;
        const currency = optionalString(body.default_currency, 'default_currency', 3);
        if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency)) throw badRequest('Invalid default_currency');
        const rate = optionalRate(body.default_hourly_rate, 'default_hourly_rate');
        if (body.rounding !== undefined && ![-1, 0, 1].includes(body.rounding as number)) throw badRequest('Invalid rounding');
        const allowedMinutes = [0, 1, 5, 6, 10, 12, 15, 30, 60, 240];
        if (body.rounding_minutes !== undefined && !allowedMinutes.includes(body.rounding_minutes as number)) throw badRequest(`Invalid rounding_minutes, allowed values are: ${allowedMinutes.join(', ')}`);
        return ctx.workspaces.update(workspaceId, { name, defaultCurrency: (currency ?? ws.defaultCurrency).toUpperCase(),
          defaultHourlyRate: rate === undefined ? ws.defaultHourlyRate : rate,
          rounding: body.rounding === undefined ? ws.rounding : body.rounding as number,
          roundingMinutes: body.rounding_minutes === undefined ? ws.roundingMinutes : body.rounding_minutes as number });
      });
    },
    async updateProfile(seen: User, credential: AccountCredential, body: Record<string, unknown>, effects: AccountEntryEffects<R>, attempt?: AccountPasswordAttempt): Promise<User> {
      const changes: AccountChanges = readProfileChanges(body);
      let passwordHash: string | undefined;
      if (body.password !== undefined) {
        const password = readNewPassword(body.password);
        const current = optionalString(body.current_password, 'current_password', Number.POSITIVE_INFINITY) ?? '';
        if (!attempt) throw new Error('Password attempt policy required');
        const valid = await attempt.attempt(() => verifyPassword(current, seen.passwordHash));
        if (valid === null) throw tooManyRequests('Too many failed attempts, try again later', attempt.retryAfterSeconds());
        if (!valid) throw badRequest('Current password is not valid');
        passwordHash = await hashPassword(password);
      }
      return emailConflict(() => runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.users.get(seen.id)) throw refused();
        if (changes.defaultWorkspaceId) {
          if (!await ctx.workspaces.get(changes.defaultWorkspaceId)) throw badRequest('Invalid default_workspace_id');
          await ctx.lockWorkspaces([changes.defaultWorkspaceId]);
        }
        await ctx.lockUsers([seen.id]);
        const user = await currentSignedIn(ctx, seen, credential);
        if (!user || (credential.kind === 'password' && user.apiToken !== seen.apiToken)) throw refused();
        if (changes.defaultWorkspaceId && !await ctx.workspaces.forMember(user.id, changes.defaultWorkspaceId)) throw badRequest('Invalid default_workspace_id');
        if (changes.email !== undefined) {
          const owner = await ctx.users.findByEmail(changes.email);
          if (owner && owner.id !== user.id) throw badRequest('Email already in use');
        }
        await ctx.users.updateAccount(user.id, changes);
        if (changes.timezone && changes.timezone !== user.timezone) await effects.reanchorTimezone(ctx, user.id, user.timezone, changes.timezone);
        if (passwordHash !== undefined) {
          if (!await ctx.users.changeCredentials(user.id, seen.passwordHash, passwordHash, generateApiToken())) throw refused();
          await ctx.sessions.deleteForUser(user.id, credential.kind === 'session' ? sha256(credential.token) : undefined);
          ctx.afterCommit(() => security.recheckUser(user.id));
        }
        return (await ctx.users.get(user.id))!;
      }), 'Email already in use');
    },
    async savePreferences(userId: Id, changes: JsonObject): Promise<JsonObject> {
      validatePreferenceChanges(changes);
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); const user = await lockExistingUser(ctx, userId);
        if (!active(user)) throw refused();
        const merged = { ...user.preferences, ...changes };
        const serialized = JSON.stringify(merged);
        if (serialized.length > 64 * 1024) throw badRequest('Preferences are too large');
        // JSON request overflow is saved as null by the existing JSON serialization behavior.
        await ctx.users.setPreferences(userId, JSON.parse(serialized) as JsonObject);
        return getPreferences((await ctx.users.get(userId))!);
      });
    },
    async updateSettings(actorId: Id, body: Record<string, unknown>, deploymentSessionDays: number): Promise<InstanceSettings> {
      const changes = readSettingChanges(body);
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId);
        await ctx.settings.write((Object.keys(changes) as Array<keyof InstanceSettings>).map(key => ({ key, value: changes[key]!, updatedAt: now(), updatedBy: actorId })));
        return getInstanceSettings(ctx, deploymentSessionDays);
      });
    },
    async revokeSessions(actorId: Id, userId: Id): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration(); await requireAdmin(ctx, actorId); await lockExistingUser(ctx, userId);
        await ctx.sessions.deleteForUser(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
      });
    },
    async rotateApiToken(seen: User, credential: AccountCredential): Promise<string> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.users.get(seen.id)) throw refused();
        await ctx.lockUsers([seen.id]);
        if (!await currentSignedIn(ctx, seen, credential)) throw refused();
        const token = generateApiToken(); await ctx.users.rotateApiToken(seen.id, token);
        ctx.afterCommit(() => security.recheckUser(seen.id));
        return token;
      });
    },
    /** Call after external password/limiter verification; this revalidates the observed hash under lock. */
    async createSession(seen: User, userAgent: string, deploymentSessionDays: number) {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!await ctx.users.get(seen.id)) throw forbidden('Incorrect email or password');
        await ctx.lockUsers([seen.id]);
        const user = await currentSignedIn(ctx, seen, { kind: 'password' });
        if (!user) throw forbidden('Incorrect email or password');
        const settings = await getInstanceSettings(ctx, deploymentSessionDays), token = generateSessionToken(), at = now();
        const expires = new Date(Date.parse(at) + settings.sessionDays * 86400000);
        await ctx.sessions.create({ tokenHash: sha256(token), userId: user.id, createdAt: at, expiresAt: expires.toISOString(), userAgent });
        await ctx.sessions.deleteExpired(at);
        return { token, expires };
      });
    },
    async findSessionUser(token: string): Promise<User | undefined> {
      return runner.readSnapshot(async ctx => {
        const session = await ctx.sessions.find(sha256(token));
        if (!session || session.expiresAt < now()) return;
        const user = await ctx.users.get(session.userId); return active(user) ? user : undefined;
      });
    },
    async deleteSession(token: string): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        const session = await ctx.sessions.find(sha256(token));
        if (!session) return;
        if (await ctx.users.get(session.userId)) await ctx.lockUsers([session.userId]);
        await ctx.sessions.delete(sha256(token));
        ctx.afterCommit(() => security.recheckUser(session.userId));
      });
    },
  };
}
