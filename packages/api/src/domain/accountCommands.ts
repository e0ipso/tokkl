/**
 * What a client asks of accounts, workspaces and instance settings, already parsed by
 * `commands/accounts.ts`. Passwords here passed the length rules; nothing is hashed yet.
 */
import type { AccountChanges } from './ports.ts';
import type { InstanceSettings, JsonObject, UserRole } from './model.ts';
import type { RoundingMode } from './workspaceValues.ts';

/** A new account from first-admin setup or an invite. The role comes from the setup or the invite. */
export interface NewAccount {
  email: string;
  fullname: string;
  /** A canonical IANA zone name. */
  timezone: string;
  password: string;
}

export interface InviteRequest {
  role: UserRole;
  note: string | null;
}

/** An admin's change to an account: at least one of the two. */
export interface AccessChange {
  role?: UserRole;
  disabled?: boolean;
}

interface PasswordChange {
  password: string;
  /** What the client sent as the current password; checked against the stored hash. */
  currentPassword: string;
}

export interface ProfileUpdate {
  changes: AccountChanges;
  password?: PasswordChange;
}

/** Known preferences hold values the app can use; other keys are kept as sent. */
export type PreferenceChanges = JsonObject;

export type SettingChanges = Partial<InstanceSettings>;

export interface WorkspaceChanges {
  /** Trimmed; absent or blank keeps the current name. */
  name?: string;
  /** An ISO 4217 code, in any case. */
  defaultCurrency?: string;
  defaultHourlyRate?: number | null;
  rounding?: RoundingMode;
  roundingMinutes?: number;
}
