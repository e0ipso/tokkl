import type { AccountRepositories, AccountRunner } from '../domain/accountGuards.ts';
import { sha256 } from '../lib/crypto.ts';
import { credentialHolds, type Authentication } from '../domain/credentials.ts';
import type { SessionsReader, UsersReader } from '../storage/contracts.ts';
import type { StreamCredentialResult } from './timerStreams.ts';

async function currentCredentialRevision(
  ctx: { users: Pick<UsersReader, 'getWithTimerRevision'>; sessions: Pick<SessionsReader, 'find'> },
  auth: Authentication,
): Promise<StreamCredentialResult> {
  const current = await ctx.users.getWithTimerRevision(auth.user.id);
  return current && (await credentialHolds(ctx, auth.user, auth.credential, current.user))
    ? { valid: true, revision: current.timerRevision }
    : { valid: false };
}

/**
 * The keep-alive check of one timer stream: the request's credential still holds, read together
 * with the user's timer revision. Storage failures fail closed and never reject the check.
 */
export function credentialCheck<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  auth: Authentication,
): () => Promise<StreamCredentialResult> {
  // Capture fingerprints now, even if HTTP locals are replaced after a profile update.
  const observed = { ...auth, user: { ...auth.user }, credential: { ...auth.credential } };
  return async () => {
    try {
      return await runner.readSnapshot(ctx => currentCredentialRevision(ctx, observed));
    } catch {
      return { valid: false };
    }
  };
}

/**
 * The key of the credential a stream check tests. Checks of one key always agree: they compare the
 * same account, verified password hash and presented token. Streams that share it share each check.
 */
export function credentialKey(auth: Authentication): string {
  const { user, credential } = auth;
  const presented = credential.kind === 'password' ? user.apiToken : credential.token;
  return sha256(JSON.stringify([user.id, user.passwordHash, credential.kind, presented]));
}
