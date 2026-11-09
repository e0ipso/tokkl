/**
 * When a sign-in still counts. Request authentication, the guarded rechecks around writes, the timer
 * stream checks and the account operations all apply these rules, so they agree on every credential.
 */
import type { SessionsRepository, UsersRepository } from './ports.ts';
import type { Session, User } from './model.ts';
import { safeEqual, sha256 } from '../lib/crypto.ts';

/** How a request signed in: a session cookie, an API token, or an email and password. */
export type AccountCredential =
  { kind: 'session'; token: string } | { kind: 'api-token'; token: string } | { kind: 'password' };

/** A signed-in request: the account as it was read, and the credential it presented. */
export interface Authentication {
  user: User;
  credential: AccountCredential;
  authMethod: 'session' | 'basic';
}

export const isActiveUser = (user: User | undefined): user is User => !!user && user.disabledAt === null;
export const isActiveAdmin = (user: User): boolean => isActiveUser(user) && user.role === 'admin';

/** Still active, with the password hash that was verified. A reset or change ends every sign-in. */
export const unchangedActive = (current: User | undefined, seen: User): current is User =>
  isActiveUser(current) && current.passwordHash === seen.passwordHash;

const sessionLive = (session: Session, now: string) => session.expiresAt >= now;

/** The live session for a cookie token and its active user. */
export async function findActiveSession(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  token: string,
): Promise<{ session: Session; user: User } | undefined> {
  const session = await ctx.sessions.find(sha256(token));
  if (!session || !sessionLive(session, new Date().toISOString())) return;
  const user = await ctx.users.get(session.userId);
  return isActiveUser(user) ? { session, user } : undefined;
}

/**
 * `current` when the credential that signed `seen` in still holds for it: the account is active
 * with the same password hash, and its session is live, or its API token is the one presented (for
 * a password sign-in, the token seen then). Tokens are compared in constant time.
 */
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

/** Reads the account again and applies `credentialHolds`, in the caller's snapshot or under its guards. */
export async function currentCredentialUser(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  seen: User,
  credential: AccountCredential,
): Promise<User | undefined> {
  return credentialHolds(ctx, seen, credential, await ctx.users.get(seen.id));
}

/** `currentCredentialUser` for a signed-in request. */
export function authenticatedUser(
  ctx: { sessions: Pick<SessionsRepository, 'find'>; users: Pick<UsersRepository, 'get'> },
  auth: Authentication,
): Promise<User | undefined> {
  return currentCredentialUser(ctx, auth.user, auth.credential);
}
