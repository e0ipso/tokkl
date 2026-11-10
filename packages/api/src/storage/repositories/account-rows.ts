import type { Kysely, Selectable } from 'kysely';
import type { Repositories } from '../../domain/ports.ts';
import type { AccountToken, MembershipRole, User, UserRole, Workspace } from '../../domain/model.ts';
import type { AccountTokensRow, PhysicalDatabase, UsersRow, WorkspacesRow } from '../physical.ts';
import { entityId, finiteNumber, jsonObject, safeInteger, utcInstant } from '../conversion.ts';

export type AccountRepositories = Pick<
  Repositories,
  'users' | 'workspaces' | 'settings' | 'tokens' | 'sessions' | 'rateLimits'
>;
function role(value: string): UserRole {
  if (value !== 'admin' && value !== 'user') throw new Error('Invalid storage account role');
  return value;
}
export function membershipRole(value: string): MembershipRole {
  if (value !== 'owner' && value !== 'member') throw new Error('Invalid storage membership role');
  return value;
}
export const nullableInstant = (value: string | null) => (value === null ? null : utcInstant(value));
export function user(row: Selectable<UsersRow>): User {
  return {
    id: entityId(row.id),
    email: row.email,
    fullName: row.fullname,
    passwordHash: row.password_hash,
    apiToken: row.api_token,
    timezone: row.timezone,
    beginningOfWeek: safeInteger(row.beginning_of_week),
    defaultWorkspaceId: entityId(row.default_workspace_id),
    preferences: jsonObject(row.preferences),
    role: role(row.role),
    disabledAt: nullableInstant(row.disabled_at),
    createdAt: utcInstant(row.created_at),
    updatedAt: utcInstant(row.updated_at),
  };
}
export function workspace(row: Selectable<WorkspacesRow>): Workspace {
  return {
    id: entityId(row.id),
    name: row.name,
    defaultCurrency: row.default_currency,
    defaultHourlyRate: row.default_hourly_rate === null ? null : finiteNumber(row.default_hourly_rate),
    rounding: safeInteger(row.rounding),
    roundingMinutes: safeInteger(row.rounding_minutes),
    createdAt: utcInstant(row.created_at),
    updatedAt: utcInstant(row.updated_at),
  };
}
export function accountToken(row: Selectable<AccountTokensRow>): AccountToken {
  if (row.kind !== 'invite' && row.kind !== 'password_reset') throw new Error('Invalid storage token kind');
  return {
    id: entityId(row.id),
    tokenHash: row.token_hash,
    kind: row.kind,
    role: row.role === null ? null : role(row.role),
    note: row.note,
    email: row.email,
    userId: row.user_id === null ? null : entityId(row.user_id),
    createdBy: row.created_by === null ? null : entityId(row.created_by),
    createdAt: utcInstant(row.created_at),
    expiresAt: utcInstant(row.expires_at),
    usedAt: nullableInstant(row.used_at),
  };
}
export const settingKeys = {
  sessionDays: 'session_days',
  inviteDays: 'invite_days',
  timeResolutionMinutes: 'time_resolution_minutes',
  signupEnabled: 'signup_enabled',
} as const;

export async function generatedId(query: { executeTakeFirstOrThrow(): Promise<{ insertId?: bigint }> }) {
  return entityId((await query.executeTakeFirstOrThrow()).insertId);
}
export async function getUser(db: Kysely<PhysicalDatabase>, id: number) {
  const row = await db.selectFrom('users').selectAll().where('id', '=', entityId(id)).executeTakeFirst();
  return row ? user(row) : undefined;
}
export async function getWorkspace(db: Kysely<PhysicalDatabase>, id: number) {
  const row = await db.selectFrom('workspaces').selectAll().where('id', '=', entityId(id)).executeTakeFirst();
  return row ? workspace(row) : undefined;
}
