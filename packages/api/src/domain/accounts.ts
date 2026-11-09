/**
 * Account operations: first-admin setup, an admin's user management and instance settings, and a
 * user's own profile, preferences and workspace settings. Links and sessions live in their own
 * modules; `createAccountOperations` puts them together.
 */
import type { OperationContext } from './ports.ts';
import type { Id, InstanceSettings, JsonObject, User, Workspace } from './model.ts';
import { forbidden, invalidInput, notFound, tooManyAttempts } from '../lib/errors.ts';
import { generateApiToken, hashPassword, sha256, verifyPassword } from '../lib/crypto.ts';
import type {
  AccessChange,
  NewAccount,
  PreferenceChanges,
  ProfileUpdate,
  SettingChanges,
  WorkspaceChanges,
} from './accountCommands.ts';
import {
  accountRecord,
  emailConflict,
  lockExistingUser,
  now,
  refused,
  requireAdmin,
  type AccountRepositories,
  type AccountRunner,
  type AccountSecurityEffects,
} from './accountGuards.ts';
import { createInviteOperations, createPasswordResetOperations } from './accountLinks.ts';
import { getPreferences, normalizeEmail } from './accountValues.ts';
import { currentCredentialUser, isActiveAdmin, isActiveUser, type AccountCredential } from './credentials.ts';
import { getInstanceSettings } from './instanceSettings.ts';
import { noWorkspaceAccess, ownedWorkspace } from './membership.ts';
import { createSessionOperations } from './sessions.ts';

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

/** The largest stored preferences object, as JSON. */
const MAX_PREFERENCES_BYTES = 64 * 1024;

function createAdminOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return {
    async createFirstAdmin(account: NewAccount): Promise<User> {
      const record = await accountRecord(account, 'admin');
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if ((await ctx.users.count()) > 0) throw forbidden('Setup has already been completed');
        return ctx.users.createAccount(record);
      });
    },
    async setAccess(actorId: Id, userId: Id, change: AccessChange): Promise<User> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        const role = change.role ?? user.role;
        const { disabled } = change;
        const disabledAt = disabled === undefined ? user.disabledAt : disabled ? (user.disabledAt ?? now()) : null;
        if (
          isActiveAdmin(user) &&
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
    /** `email` is what the admin typed to confirm; it must name the account being deleted. */
    async deleteAccount(
      actorId: Id,
      userId: Id,
      email: string | undefined,
      effects: AccountEntryEffects<R>,
    ): Promise<void> {
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
        if (email === undefined || normalizeEmail(email) !== normalizeEmail(user.email))
          throw invalidInput("Enter the account's email to confirm the deletion");
        if (isActiveAdmin(user) && (await ctx.users.countActiveAdmins()) <= 1)
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
    async updateSettings(
      actorId: Id,
      changes: SettingChanges,
      deploymentSessionDays: number,
    ): Promise<InstanceSettings> {
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
  };
}

/** The hash of the new password, once the current one checked out under the shared attempt limit. */
async function verifiedPasswordHash(
  seen: User,
  change: NonNullable<ProfileUpdate['password']>,
  attempt: AccountPasswordAttempt | undefined,
): Promise<string> {
  if (!attempt) throw new Error('Password attempt policy required');
  const result = await attempt.attempt(() => verifyPassword(change.currentPassword, seen.passwordHash));
  if (result.refused) throw tooManyAttempts('Too many failed attempts, try again later', result.retryAfter);
  if (!result.valid) throw invalidInput('Current password is not valid');
  return hashPassword(change.password);
}

function createProfileOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  /** Writes the profile under the user's guard; the credential must still hold there. */
  async function applyProfile(
    ctx: OperationContext<R>,
    seen: User,
    credential: AccountCredential,
    { changes }: ProfileUpdate,
    passwordHash: string | undefined,
    effects: AccountEntryEffects<R>,
  ): Promise<User> {
    await ctx.lockInstanceAdministration();
    if (!(await ctx.users.get(seen.id))) throw refused();
    if (changes.defaultWorkspaceId) {
      if (!(await ctx.workspaces.get(changes.defaultWorkspaceId))) throw invalidInput('Invalid default_workspace_id');
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
      await ctx.sessions.deleteForUser(user.id, credential.kind === 'session' ? sha256(credential.token) : undefined);
      ctx.afterCommit(() => security.recheckUser(user.id));
    }
    return (await ctx.users.get(user.id))!;
  }
  return {
    async updateWorkspace(userId: Id, workspaceId: Id, changes: WorkspaceChanges): Promise<Workspace> {
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!(await ctx.workspaces.get(workspaceId))) throw noWorkspaceAccess();
        await ctx.lockWorkspaces([workspaceId]);
        if (!isActiveUser(await ctx.users.get(userId))) throw refused();
        const ws = await ownedWorkspace(ctx, userId, workspaceId);
        return ctx.workspaces.update(workspaceId, {
          name: changes.name ?? ws.name,
          defaultCurrency: (changes.defaultCurrency ?? ws.defaultCurrency).toUpperCase(),
          defaultHourlyRate: changes.defaultHourlyRate === undefined ? ws.defaultHourlyRate : changes.defaultHourlyRate,
          rounding: changes.rounding ?? ws.rounding,
          roundingMinutes: changes.roundingMinutes ?? ws.roundingMinutes,
        });
      });
    },
    /** A password change also needs the current password, checked through `attempt`. */
    async updateProfile(
      seen: User,
      credential: AccountCredential,
      update: ProfileUpdate,
      effects: AccountEntryEffects<R>,
      attempt?: AccountPasswordAttempt,
    ): Promise<User> {
      const passwordHash = update.password ? await verifiedPasswordHash(seen, update.password, attempt) : undefined;
      return emailConflict(
        () => runner.transaction(ctx => applyProfile(ctx, seen, credential, update, passwordHash, effects)),
        'Email already in use',
      );
    },
  };
}

/**
 * Saving preferences guards only the user. A deletion that commits while the save waits makes the
 * user lock restart the transaction, which then finds the account gone.
 */
export function createPreferenceOperations<R extends AccountRepositories>(
  runner: Pick<AccountRunner<R>, 'transaction'>,
) {
  return {
    async savePreferences(userId: Id, changes: PreferenceChanges): Promise<JsonObject> {
      return runner.transaction(async ctx => {
        const user = await lockExistingUser(ctx, userId);
        if (!isActiveUser(user)) throw refused();
        const serialized = JSON.stringify({ ...user.preferences, ...changes });
        if (serialized.length > MAX_PREFERENCES_BYTES) throw invalidInput('Preferences are too large');
        // JSON request overflow is saved as null by the existing JSON serialization behavior.
        await ctx.users.setPreferences(userId, JSON.parse(serialized) as JsonObject);
        return getPreferences((await ctx.users.get(userId))!);
      });
    },
  };
}

export function createAccountOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return {
    ...createAdminOperations(runner, security),
    ...createInviteOperations(runner),
    ...createPasswordResetOperations(runner, security),
    ...createProfileOperations(runner, security),
    ...createPreferenceOperations(runner),
    ...createSessionOperations(runner, security),
  };
}
export type AccountOperations<R extends AccountRepositories = AccountRepositories> = ReturnType<
  typeof createAccountOperations<R>
>;
