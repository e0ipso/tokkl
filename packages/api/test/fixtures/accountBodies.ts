/**
 * The account operations as a request reaches them: each raw body is parsed by the same command
 * parser the routes use, then handed to the domain. Link routes look the link up before they read
 * the body, so these do too. Domain tests keep their bodies.
 */
import * as parse from '../../src/commands/accounts.ts';
import * as domain from '../../src/domain/accounts.ts';
import { findResetUser, findUsableInvite, INVITE_NOT_FOUND, RESET_NOT_FOUND } from '../../src/domain/accountLinks.ts';
import type { AccountRepositories, AccountRunner, AccountSecurityEffects } from '../../src/domain/accountGuards.ts';
import type { AccountPasswordAttempt } from '../../src/domain/accounts.ts';
import type { AccountCredential } from '../../src/domain/credentials.ts';
import { notFound } from '../../src/lib/errors.ts';
import type { User } from '../../src/storage/domain.ts';

export { createAccountOperations as createDomainAccountOperations } from '../../src/domain/accounts.ts';

type Body = Record<string, unknown>;

export function createAccountOperations<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  security: AccountSecurityEffects,
) {
  return withBodies(domain.createAccountOperations(runner, security), runner);
}

/** `operations` taking raw bodies; `runner` reads the links the way the link routes do. */
export function withBodies<R extends AccountRepositories>(
  operations: domain.AccountOperations<R>,
  runner: AccountRunner<R>,
) {
  return {
    ...operations,
    createFirstAdmin: async (body: Body) => operations.createFirstAdmin(parse.parseNewAccount(body)),
    createInvite: async (actorId: number, body: Body, deploymentSessionDays: number) =>
      operations.createInvite(actorId, parse.parseInvite(body), deploymentSessionDays),
    async acceptInvite(token: string, body: Body) {
      if (!(await runner.readSnapshot(ctx => findUsableInvite(ctx, token)))?.role) throw notFound(INVITE_NOT_FOUND);
      return operations.acceptInvite(token, parse.parseNewAccount(body));
    },
    async resetPassword(token: string, password: unknown) {
      if (!(await runner.readSnapshot(ctx => findResetUser(ctx, token)))) throw notFound(RESET_NOT_FOUND);
      return operations.resetPassword(token, parse.parseNewPassword(password));
    },
    setAccess: async (actorId: number, userId: number, body: Body) =>
      operations.setAccess(actorId, userId, parse.parseAccessChange(body)),
    deleteAccount: async (actorId: number, userId: number, email: unknown, effects: domain.AccountEntryEffects<R>) =>
      operations.deleteAccount(actorId, userId, parse.parseDeletionConfirmation({ email }), effects),
    updateWorkspace: async (userId: number, workspaceId: number, body: Body) =>
      operations.updateWorkspace(userId, workspaceId, parse.parseWorkspaceChanges(body)),
    updateProfile: async (
      seen: User,
      credential: AccountCredential,
      body: Body,
      effects: domain.AccountEntryEffects<R>,
      attempt?: AccountPasswordAttempt,
    ) => operations.updateProfile(seen, credential, parse.parseProfileUpdate(body), effects, attempt),
    savePreferences: async (userId: number, body: Body) =>
      operations.savePreferences(userId, parse.parsePreferenceChanges(body)),
    updateSettings: async (actorId: number, body: Body, deploymentSessionDays: number) =>
      operations.updateSettings(actorId, parse.parseSettingChanges(body), deploymentSessionDays),
  };
}
