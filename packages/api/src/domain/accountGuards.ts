/** What every account operation shares: its repositories and runner, and the guards it takes. */
import type { OperationContext, Repositories } from './ports.ts';
import type { Id, User, UserRole } from './model.ts';
import { StorageConflict } from './ports.ts';
import { forbidden, invalidInput, notFound } from '../lib/errors.ts';
import { generateApiToken, hashPassword } from '../lib/crypto.ts';
import type { NewAccount } from './accountCommands.ts';
import { DEFAULT_PREFERENCES } from './accountValues.ts';
import { isActiveAdmin } from './credentials.ts';

export type AccountRepositories = Pick<Repositories, 'users' | 'workspaces' | 'settings' | 'tokens' | 'sessions'>;
export type AccountContext = OperationContext<AccountRepositories>;
export interface AccountRunner<R extends AccountRepositories = AccountRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: AccountRepositories) => Promise<T>): Promise<T>;
}
/** Application composition supplies local stream credential rechecks. Called after confirmed commit. */
export interface AccountSecurityEffects {
  recheckUser(userId: Id): Promise<void>;
}

export const now = () => new Date().toISOString();
export const refused = () => forbidden('Incorrect username and/or password');

/** The user under its guard. A deletion that commits meanwhile restarts the transaction. */
export async function lockExistingUser(ctx: AccountContext, id: Id): Promise<User> {
  if (!(await ctx.users.get(id))) throw notFound('User not found');
  await ctx.lockUsers([id]);
  return (await ctx.users.get(id))!;
}
export async function requireAdmin(ctx: AccountContext, id: Id) {
  const actor = await ctx.users.get(id);
  if (!actor || !isActiveAdmin(actor)) throw forbidden('Admin access required');
}
/** The stored record of a new account: the password hashed, a fresh API token, default preferences. */
export async function accountRecord(account: NewAccount, role: UserRole) {
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
/** Runs `work`, turning a unique-email conflict into a 400 with `message`. */
export async function emailConflict<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageConflict && error.kind === 'unique') throw invalidInput(message);
    throw error;
  }
}
