/** Single-use tokens, stored as hashes. */
import { now } from '../lib/clock.ts';
import type { TokensRepository, UsersRepository } from './ports.ts';
import type { Id, User } from './model.ts';
import { invalidInput, notFound } from '../lib/errors.ts';
import { generateApiToken, generateSessionToken, hashPassword, sha256 } from '../lib/crypto.ts';
import type { InviteRequest, NewAccount } from './accountCommands.ts';
import {
  accountRecord,
  emailConflict,
  lockExistingUser,
  requireAdmin,
  type AccountRepositories,
  type AccountRunner,
  type AccountSecurityEffects,
} from './accountGuards.ts';
import { getInstanceSettings } from './instanceSettings.ts';
import { isActiveUser } from './credentials.ts';

export const INVITE_NOT_FOUND = 'This invite link is not valid. Ask your admin for a new one.';
export const RESET_NOT_FOUND = 'This password reset link is not valid. Ask your admin for a new one.';
const PASSWORD_RESET_HOURS = 24;

export async function findUsableInvite(ctx: { tokens: Pick<TokensRepository, 'findUsable'> }, token: string) {
  return ctx.tokens.findUsable(sha256(token), 'invite', now());
}
export async function findResetUser(
  ctx: { tokens: Pick<TokensRepository, 'findUsable'>; users: Pick<UsersRepository, 'get'> },
  token: string,
): Promise<User | undefined> {
  const reset = await ctx.tokens.findUsable(sha256(token), 'password_reset', now());
  const user = reset?.userId ? await ctx.users.get(reset.userId) : undefined;
  return isActiveUser(user) ? user : undefined;
}

export function createInviteOperations<R extends AccountRepositories>(runner: AccountRunner<R>) {
  return {
    async createInvite(actorId: Id, request: InviteRequest, deploymentSessionDays: number) {
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const at = now(),
          settings = await getInstanceSettings(ctx, deploymentSessionDays);
        const invite = await ctx.tokens.create({
          tokenHash: sha256(token),
          kind: 'invite',
          role: request.role,
          note: request.note,
          email: null,
          userId: null,
          createdBy: actorId,
          createdAt: at,
          expiresAt: new Date(Date.parse(at) + settings.inviteDays * 86400000).toISOString(),
          usedAt: null,
        });
        return { token, invite };
      });
    },
    async acceptInvite(token: string, account: NewAccount): Promise<User> {
      // Answer the public link error before the slow password hash, then check again under guards.
      const usable = await runner.readSnapshot(ctx => ctx.tokens.findUsable(sha256(token), 'invite', now()));
      if (!usable?.role) throw notFound(INVITE_NOT_FOUND);
      const record = await accountRecord(account, usable.role);
      return emailConflict(
        () =>
          runner.transaction(async ctx => {
            await ctx.lockInstanceAdministration();
            const invite = await ctx.tokens.findUsable(sha256(token), 'invite', now());
            if (!invite?.role) throw notFound(INVITE_NOT_FOUND);
            if (await ctx.users.findByEmail(record.email))
              throw invalidInput('An account with this email already exists');
            const user = await ctx.users.createAccount({ ...record, role: invite.role });
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
  };
}

export function createPasswordResetOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return {
    async createPasswordReset(actorId: Id, userId: Id) {
      const token = generateSessionToken();
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        await requireAdmin(ctx, actorId);
        const user = await lockExistingUser(ctx, userId);
        if (!isActiveUser(user)) throw invalidInput('Enable the account before resetting its password');
        await ctx.tokens.revokeUnusedPasswordResets(userId);
        const at = now();
        const reset = await ctx.tokens.create({
          tokenHash: sha256(token),
          kind: 'password_reset',
          role: null,
          note: null,
          email: null,
          userId,
          createdBy: actorId,
          createdAt: at,
          expiresAt: new Date(Date.parse(at) + PASSWORD_RESET_HOURS * 3600000).toISOString(),
          usedAt: null,
        });
        return { token, reset };
      });
    },
    /** The reset ends every session and the old API token. */
    async resetPassword(token: string, password: string): Promise<User> {
      const hash = sha256(token);
      const candidate = await runner.readSnapshot(async ctx => {
        const reset = await ctx.tokens.findUsable(hash, 'password_reset', now());
        return reset?.userId ? ctx.users.get(reset.userId) : undefined;
      });
      if (!isActiveUser(candidate)) throw notFound(RESET_NOT_FOUND);
      const passwordHash = await hashPassword(password);
      return runner.transaction(async ctx => {
        await ctx.lockInstanceAdministration();
        if (!(await ctx.users.get(candidate.id))) throw notFound(RESET_NOT_FOUND);
        await ctx.lockUsers([candidate.id]);
        const user = await ctx.users.get(candidate.id);
        const reset = await ctx.tokens.findUsable(hash, 'password_reset', now());
        if (!isActiveUser(user) || !reset || reset.userId !== user.id || !(await ctx.tokens.consume(reset.id, now())))
          throw notFound(RESET_NOT_FOUND);
        if (!(await ctx.users.changeCredentials(user.id, user.passwordHash, passwordHash, generateApiToken())))
          throw notFound(RESET_NOT_FOUND);
        await ctx.sessions.deleteForUser(user.id);
        ctx.afterCommit(() => security.recheckUser(user.id));
        return (await ctx.users.get(user.id))!;
      });
    },
  };
}
