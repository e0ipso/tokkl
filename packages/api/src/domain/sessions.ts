/**
 * Sign-in sessions and the API token: starting and ending them, and rotating the token. Starting
 * and ending a session guard only the user: a deletion that commits while one waits makes its lock
 * restart the transaction, which then finds the account gone and refuses, as it does for an
 * account deleted before the request started.
 */
import type { User } from './model.ts';
import { forbidden } from '../lib/errors.ts';
import { generateApiToken, generateSessionToken, sha256 } from '../lib/crypto.ts';
import {
  now,
  refused,
  type AccountRepositories,
  type AccountRunner,
  type AccountSecurityEffects,
} from './accountGuards.ts';
import { currentCredentialUser, findActiveSession, unchangedActive, type AccountCredential } from './credentials.ts';
import { getInstanceSettings } from './instanceSettings.ts';

export function createSessionOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return {
    /** Call after external password/limiter verification; this revalidates the observed hash under lock. */
    async createSession(seen: User, userAgent: string, deploymentSessionDays: number) {
      return runner.transaction(async ctx => {
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
        return { token, expires };
      });
    },
    async findSessionUser(token: string): Promise<User | undefined> {
      return runner.readSnapshot(async ctx => (await findActiveSession(ctx, token))?.user);
    },
    async deleteSession(token: string): Promise<void> {
      await runner.transaction(async ctx => {
        const session = await ctx.sessions.find(sha256(token));
        if (!session) return;
        if (await ctx.users.get(session.userId)) await ctx.lockUsers([session.userId]);
        await ctx.sessions.delete(sha256(token));
        ctx.afterCommit(() => security.recheckUser(session.userId));
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
  };
}
