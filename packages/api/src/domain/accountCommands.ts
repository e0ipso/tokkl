/** Parsed by `commands/accounts.ts`. Passwords passed the length rules; nothing is hashed yet. */
import type { AccountChanges } from './ports.ts';
import type { InstanceSettings, JsonObject, UserRole } from './model.ts';
import type { RoundingMode } from './workspaceValues.ts';

/** The role comes from the setup or the invite. */
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

/** At least one of the two. */
export interface AccessChange {
  role?: UserRole;
  disabled?: boolean;
}

interface PasswordChange {
  password: string;
  currentPassword: string;
}

export interface ProfileUpdate {
  changes: AccountChanges;
  password?: PasswordChange;
}

/** Known preferences hold usable values; other keys are kept as sent. */
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
