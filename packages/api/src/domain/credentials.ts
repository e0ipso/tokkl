/** Request auth, guarded rechecks, timer stream checks and account operations all apply these rules. */
import type { SessionsRepository, UsersRepository } from './ports.ts';
import type { Session, User } from './model.ts';
import { safeEqual, sha256 } from '../lib/crypto.ts';

export type AccountCredential =
  { kind: 'session'; token: string } | { kind: 'api-token'; token: string } | { kind: 'password' };

export interface Authentication {
  user: User;
  credential: AccountCredential;
  authMethod: 'session' | 'basic';
}

export const isActiveUser = (user: User | undefined): user is User => !!user && user.disabledAt === null;
export const isActiveAdmin = (user: User): boolean => isActiveUser(user) && user.role === 'admin';

/** A password reset or change ends every sign-in. */
export const unchangedActive = (current: User | undefined, seen: User): current is User =>
  isActiveUser(current) && current.passwordHash === seen.passwordHash;

const sessionLive = (session: Session, now: string) => session.expiresAt >= now;

export async function findActiveSession(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  token: string,
): Promise<{ session: Session; user: User } | undefined> {
  const session = await ctx.sessions.find(sha256(token));
  if (!session || !sessionLive(session, new Date().toISOString())) return;
  const user = await ctx.users.get(session.userId);
  return isActiveUser(user) ? { session, user } : undefined;
}

/** Active with the same hash, and a live session or the matching API token (compared in constant time). */
export async function credentialHolds(
  ctx: { sessions: Pick<SessionsRepository, 'find'> },
  seen: User,
  credential: AccountCredential,
  current: User | undefined,
): Promise<User | undefined> {
  if (!unchangedActive(current, seen)) return;
  if (credential.kind === 'session') {
    const session = await ctx.sessions.find(sha256(credential.token));
    if (!session || session.userId !== current.id || !sessionLive(session, new Date().toISOString())) return;
    return current;
  }
  const presented = credential.kind === 'api-token' ? credential.token : seen.apiToken;
  return safeEqual(current.apiToken, presented) ? current : undefined;
}

/** In the caller's snapshot or under its guards. */
export async function currentCredentialUser(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  seen: User,
  credential: AccountCredential,
): Promise<User | undefined> {
  return credentialHolds(ctx, seen, credential, await ctx.users.get(seen.id));
}

export function authenticatedUser(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  auth: Authentication,
): Promise<User | undefined> {
  return currentCredentialUser(ctx, auth.user, auth.credential);
}
