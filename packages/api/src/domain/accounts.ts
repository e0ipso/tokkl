import type { AccountChanges, OperationContext, Repositories } from '../storage/contracts.ts';
import type { Id, InstanceSettings, JsonObject, User, UserRole, Workspace } from '../storage/domain.ts';
import { StorageConflict } from '../storage/errors.ts';
import { getInstanceSettings, readSettingChanges } from './instanceSettings.ts';
import { memberWorkspace, noWorkspaceAccess } from './membership.ts';
import {
  currentCredentialUser,
  findActiveSession,
  isActiveAdmin,
  isActiveUser,
  unchangedActive,
  type AccountCredential,
} from './credentials.ts';
import { isCurrencyCode, isRoundingMinutes, isRoundingMode, ROUNDING_MINUTES } from './workspaceValues.ts';
import { invalidInput, forbidden, notFound, tooManyAttempts } from '../lib/errors.ts';
import { optionalBool, optionalRate, optionalString } from '../lib/values.ts';
import { generateApiToken, generateSessionToken, hashPassword, sha256, verifyPassword } from '../lib/crypto.ts';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  normalizeEmail,
  readNewAccount,
  readNewPassword,
  readProfileChanges,
  validatePreferenceChanges,
} from './accountValues.ts';

export type AccountRepositories = Pick<Repositories, 'users' | 'workspaces' | 'settings' | 'tokens' | 'sessions'>;
export type AccountContext = OperationContext<AccountRepositories>;
export interface AccountRunner<R extends AccountRepositories = AccountRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
export type { AccountCredential };
export { isActiveAdmin, isActiveUser };
/** An attempt either ran its check, or was refused unchecked with the seconds to wait. */
export type PasswordAttemptResult = { refused: false; valid: boolean } | { refused: true; retryAfter: number };
/** The HTTP/auth adapter supplies FailureLimiter.attempt with passwordCounters and its address. */
export interface AccountPasswordAttempt {
  attempt(check: () => Promise<boolean>): Promise<PasswordAttemptResult>;
}
/** Required at operations that need entry/timer work. Implement with the same operation context. */
export interface AccountEntryEffects<R extends AccountRepositories = AccountRepositories> {
  reanchorTimezone(context: OperationContext<R>, userId: Id, oldTimezone: string, newTimezone: string): Promise<void>;
  /** Discover timer owners under workspace guards, before acquiring the complete sorted user set. */
  affectedDeletionUsers(context: OperationContext<R>, userId: Id, workspaces: Workspace[]): Promise<Id[]>;
  beforeDelete(context: OperationContext<R>, user: User, soleWorkspaces: Workspace[]): Promise<void>;
}
/** Application composition supplies local stream credential rechecks. Called after confirmed commit. */
export interface AccountSecurityEffects {
  recheckUser(userId: Id): Promise<void>;
}
export const INVITE_NOT_FOUND = 'This invite link is not valid. Ask your admin for a new one.';
export const RESET_NOT_FOUND = 'This password reset link is not valid. Ask your admin for a new one.';
export const PASSWORD_RESET_HOURS = 24;
export const MAX_INVITE_NOTE_LENGTH = 255;
const now = () => new Date().toISOString();
const active = isActiveUser;
const activeAdmin = isActiveAdmin;
const refused = () => forbidden('Incorrect username and/or password');

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
  if (!(await ctx.users.get(id))) throw notFound('User not found');
  await ctx.lockUsers([id]);
  return (await ctx.users.get(id))!;
}
async function requireAdmin(ctx: AccountContext, id: Id) {
  const actor = await ctx.users.get(id);
  if (!actor || !activeAdmin(actor)) throw forbidden('Admin access required');
}
async function accountInput(input: Record<string, unknown>, role: UserRole) {
  const account = readNewAccount(input);
  return {
    email: account.email,
    fullName: account.fullname,
    timezone: account.timezone,
    passwordHash: await hashPassword(account.password),
    apiToken: generateApiToken(),
    role,
    preferences: { ...DEFAULT_PREFERENCES, pg_time_zone_name: account.timezone },
  };
}
async function emailConflict<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageConflict && error.kind === 'unique') throw invalidInput(message);
    throw error;
  }
}
export function createAccountOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return {
    async createFirstAdmin(input: Record<string, unknown>): Promise<User> {
      const account = await accountInput(input, 'admin');
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if ((await ctx.users.count()) > 0) throw forbidden('Setup has already been completed');
        return ctx.users.createAccount(account);
      });
    },
    async createInvite(actorId: Id, input: { role: unknown; note?: unknown }, deploymentSessionDays: number) {
      if (input.role !== 'admin' && input.role !== 'user') throw invalidInput('Invalid role: expected admin or user');
      const role = input.role;
      const note = optionalString(input.note, 'note', MAX_INVITE_NOTE_LENGTH)?.trim() || null;
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const at = now(),
          settings = await getInstanceSettings(ctx, deploymentSessionDays);
        const invite = await ctx.tokens.create({
          tokenHash: sha256(token),
          kind: 'invite',
          role,
          note,
          userId: null,
          createdBy: actorId,
          createdAt: at,
          expiresAt: new Date(Date.parse(at) + settings.inviteDays * 86400000).toISOString(),
          usedAt: null,
        });
        return { token, invite };
      });
    },
    async acceptInvite(token: string, input: Record<string, unknown>): Promise<User> {
      // Preserve the public link error before expensive password work, then check again under guards.
      const usable = await runner.readSnapshot(ctx => ctx.tokens.findUsable(sha256(token), 'invite', now()));
      if (!usable?.role) throw notFound(INVITE_NOT_FOUND);
      const account = await accountInput(input, usable.role);
      return emailConflict(
        () =>
          runner.transaction(async ctx => {
            await ctx.lockInstanceAdministration();
            const invite = await ctx.tokens.findUsable(sha256(token), 'invite', now());
            if (!invite?.role) throw notFound(INVITE_NOT_FOUND);
            if (await ctx.users.findByEmail(account.email))
              throw invalidInput('An account with this email already exists');
            const user = await ctx.users.createAccount({ ...account, role: invite.role });
            if (!(await ctx.tokens.consume(invite.id, now(), user.id))) throw notFound(INVITE_NOT_FOUND);
            return user;
          }),
        'An account with this email already exists',
      );
    },
    async revokeInvite(actorId: Id, id: Id): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        if (!(await ctx.tokens.revokeInvite(id))) throw notFound('Invite not found');
      });
    },
    async createPasswordReset(actorId: Id, userId: Id) {
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        if (!active(user)) throw invalidInput('Enable the account before resetting its password');
        await ctx.tokens.revokeUnusedPasswordResets(userId);
        const at = now();
        const reset = await ctx.tokens.create({
          tokenHash: sha256(token),
          kind: 'password_reset',
          role: null,
          note: null,
          userId,
          createdBy: actorId,
          createdAt: at,
          expiresAt: new Date(Date.parse(at) + PASSWORD_RESET_HOURS * 3600000).toISOString(),
          usedAt: null,
        });
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
        if (!(await ctx.users.get(candidate.id))) throw notFound(RESET_NOT_FOUND);
        await ctx.lockUsers([candidate.id]);
        const user = await ctx.users.get(candidate.id);
        const reset = await ctx.tokens.findUsable(hash, 'password_reset', now());
        if (!active(user) || !reset || reset.userId !== user.id || !(await ctx.tokens.consume(reset.id, now())))
          throw notFound(RESET_NOT_FOUND);
        if (!(await ctx.users.changeCredentials(user.id, user.passwordHash, passwordHash, generateApiToken())))
          throw notFound(RESET_NOT_FOUND);
        await ctx.sessions.deleteForUser(user.id);
        ctx.afterCommit(() => security.recheckUser(user.id));
        return (await ctx.users.get(user.id))!;
      });
    },
    async setAccess(actorId: Id, userId: Id, body: Record<string, unknown>): Promise<User> {
      if (body.role !== undefined && body.role !== 'admin' && body.role !== 'user')
        throw invalidInput('Invalid role: expected admin or user');
      const roleChange = body.role;
      const disabled = optionalBool(body.disabled, 'disabled');
      if (roleChange === undefined && disabled === undefined) throw invalidInput('Expected role or disabled');
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        const role = roleChange ?? user.role;
        const disabledAt = disabled === undefined ? user.disabledAt : disabled ? (user.disabledAt ?? now()) : null;
        if (
          activeAdmin(user) &&
          (role !== 'admin' || disabledAt !== null) &&
          (await ctx.users.countActiveAdmins()) <= 1
        )
          throw invalidInput('At least one active admin must remain');
        const updated = await ctx.users.setAccess(userId, role, disabledAt);
        if (disabled) await ctx.sessions.deleteForUser(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
        return updated;
      });
    },
    async deleteAccount(actorId: Id, userId: Id, email: unknown, effects: AccountEntryEffects<R>): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        if (!(await ctx.users.get(userId))) throw notFound('User not found');
        const workspaces = await ctx.workspaces.listForUser(userId);
        await ctx.lockWorkspaces(workspaces.map(w => w.id));
        const members = (await Promise.all(workspaces.map(ws => ctx.workspaces.listMembers(ws.id)))).flat();
        const affectedUsers = await effects.affectedDeletionUsers(ctx, userId, workspaces);
        await ctx.lockUsers([...members.map(m => m.userId), ...affectedUsers, userId]);
        const user = (await ctx.users.get(userId))!;
        if (typeof email !== 'string' || normalizeEmail(email) !== normalizeEmail(user.email))
          throw invalidInput("Enter the account's email to confirm the deletion");
        if (activeAdmin(user) && (await ctx.users.countActiveAdmins()) <= 1)
          throw invalidInput('At least one active admin must remain');
        if (actorId === userId) throw invalidInput('You cannot delete your own account');
        const sole = [];
        for (const ws of workspaces) if ((await ctx.workspaces.countMembers(ws.id)) === 1) sole.push(ws);
        await effects.beforeDelete(ctx, user, sole);
        await ctx.workspaces.deleteSoleMemberWorkspaces(userId);
        await ctx.tokens.revokeInvitesCreatedBy(userId);
        await ctx.users.delete(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
      });
    },
    async updateWorkspace(userId: Id, workspaceId: Id, body: Record<string, unknown>): Promise<Workspace> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!(await ctx.workspaces.get(workspaceId))) throw noWorkspaceAccess();
        await ctx.lockWorkspaces([workspaceId]);
        if (!active(await ctx.users.get(userId))) throw refused();
        const ws = await memberWorkspace(ctx, userId, workspaceId);
        const name = optionalString(body.name, 'name', 140)?.trim() || ws.name;
        const currency = optionalString(body.default_currency, 'default_currency', 3);
        if (currency !== undefined && !isCurrencyCode(currency)) throw invalidInput('Invalid default_currency');
        const rate = optionalRate(body.default_hourly_rate, 'default_hourly_rate');
        const { rounding, rounding_minutes: roundingMinutes } = body;
        if (rounding !== undefined && !isRoundingMode(rounding)) throw invalidInput('Invalid rounding');
        if (roundingMinutes !== undefined && !isRoundingMinutes(roundingMinutes))
          throw invalidInput(`Invalid rounding_minutes, allowed values are: ${ROUNDING_MINUTES.join(', ')}`);
        return ctx.workspaces.update(workspaceId, {
          name,
          defaultCurrency: (currency ?? ws.defaultCurrency).toUpperCase(),
          defaultHourlyRate: rate === undefined ? ws.defaultHourlyRate : rate,
          rounding: rounding ?? ws.rounding,
          roundingMinutes: roundingMinutes ?? ws.roundingMinutes,
        });
      });
    },
    async updateProfile(
      seen: User,
      credential: AccountCredential,
      body: Record<string, unknown>,
      effects: AccountEntryEffects<R>,
      attempt?: AccountPasswordAttempt,
    ): Promise<User> {
      const changes: AccountChanges = readProfileChanges(body);
      let passwordHash: string | undefined;
      if (body.password !== undefined) {
        const password = readNewPassword(body.password);
        const current = optionalString(body.current_password, 'current_password', Number.POSITIVE_INFINITY) ?? '';
        if (!attempt) throw new Error('Password attempt policy required');
        const result = await attempt.attempt(() => verifyPassword(current, seen.passwordHash));
        if (result.refused) throw tooManyAttempts('Too many failed attempts, try again later', result.retryAfter);
        if (!result.valid) throw invalidInput('Current password is not valid');
        passwordHash = await hashPassword(password);
      }
      return emailConflict(
        () =>
          runner.transaction(async ctx => {
            await ctx.lockInstanceAdministration();
            if (!(await ctx.users.get(seen.id))) throw refused();
            if (changes.defaultWorkspaceId) {
              if (!(await ctx.workspaces.get(changes.defaultWorkspaceId)))
                throw invalidInput('Invalid default_workspace_id');
              await ctx.lockWorkspaces([changes.defaultWorkspaceId]);
            }
            await ctx.lockUsers([seen.id]);
            const user = await currentCredentialUser(ctx, seen, credential);
            if (!user) throw refused();
            if (changes.defaultWorkspaceId && !(await ctx.workspaces.forMember(user.id, changes.defaultWorkspaceId)))
              throw invalidInput('Invalid default_workspace_id');
            if (changes.email !== undefined) {
              const owner = await ctx.users.findByEmail(changes.email);
              if (owner && owner.id !== user.id) throw invalidInput('Email already in use');
            }
            await ctx.users.updateAccount(user.id, changes);
            if (changes.timezone && changes.timezone !== user.timezone)
              await effects.reanchorTimezone(ctx, user.id, user.timezone, changes.timezone);
            if (passwordHash !== undefined) {
              if (!(await ctx.users.changeCredentials(user.id, seen.passwordHash, passwordHash, generateApiToken())))
                throw refused();
              await ctx.sessions.deleteForUser(
                user.id,
                credential.kind === 'session' ? sha256(credential.token) : undefined,
              );
              ctx.afterCommit(() => security.recheckUser(user.id));
            }
            return (await ctx.users.get(user.id))!;
          }),
        'Email already in use',
      );
    },
    async savePreferences(userId: Id, changes: Record<string, unknown>): Promise<JsonObject> {
      validatePreferenceChanges(changes);
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        const user = await lockExistingUser(ctx, userId);
        if (!active(user)) throw refused();
        const merged = { ...user.preferences, ...changes };
        const serialized = JSON.stringify(merged);
        if (serialized.length > 64 * 1024) throw invalidInput('Preferences are too large');
        // JSON request overflow is saved as null by the existing JSON serialization behavior.
        await ctx.users.setPreferences(userId, JSON.parse(serialized) as JsonObject);
        return getPreferences((await ctx.users.get(userId))!);
      });
    },
    async updateSettings(
      actorId: Id,
      body: Record<string, unknown>,
      deploymentSessionDays: number,
    ): Promise<InstanceSettings> {
      const changes = readSettingChanges(body);
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        await ctx.settings.write(
          (Object.keys(changes) as Array<keyof InstanceSettings>).map(key => ({
            key,
            value: changes[key]!,
            updatedAt: now(),
            updatedBy: actorId,
          })),
        );
        return getInstanceSettings(ctx, deploymentSessionDays);
      });
    },
    async revokeSessions(actorId: Id, userId: Id): Promise<void> {
      await runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        await lockExistingUser(ctx, userId);
        await ctx.sessions.deleteForUser(userId);
        ctx.afterCommit(() => security.recheckUser(userId));
      });
    },
    async rotateApiToken(seen: User, credential: AccountCredential): Promise<string> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!(await ctx.users.get(seen.id))) throw refused();
        await ctx.lockUsers([seen.id]);
        if (!(await currentCredentialUser(ctx, seen, credential))) throw refused();
        const token = generateApiToken();
        await ctx.users.rotateApiToken(seen.id, token);
        ctx.afterCommit(() => security.recheckUser(seen.id));
        return token;
      });
    },
    /** Call after external password/limiter verification; this revalidates the observed hash under lock. */
    async createSession(seen: User, userAgent: string, deploymentSessionDays: number) {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!(await ctx.users.get(seen.id))) throw forbidden('Incorrect email or password');
        await ctx.lockUsers([seen.id]);
        // The password was verified before the guards; it must still be the account's password.
        const user = await ctx.users.get(seen.id);
        if (!unchangedActive(user, seen)) throw forbidden('Incorrect email or password');
        const settings = await getInstanceSettings(ctx, deploymentSessionDays),
          token = generateSessionToken(),
          at = now();
        const expires = new Date(Date.parse(at) + settings.sessionDays * 86400000);
        await ctx.sessions.create({
          tokenHash: sha256(token),
          userId: user.id,
          createdAt: at,
          expiresAt: expires.toISOString(),
          userAgent,
        });
        await ctx.sessions.deleteExpired(at);
        return { token, expires };
      });
    },
    async findSessionUser(token: string): Promise<User | undefined> {
      return runner.readSnapshot(async ctx => (await findActiveSession(ctx, token))?.user);
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
