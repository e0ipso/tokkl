import { canonicalTimeZone } from '@tokkl/common/time';
import type {
  AccessChange,
  InviteRequest,
  NewAccount,
  PreferenceChanges,
  ProfileUpdate,
  SettingChanges,
  WorkspaceChanges,
} from '../domain/accountCommands.ts';
import {
  isEmailAddress,
  MAX_ACCOUNT_TEXT_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  preferenceProblem,
} from '../domain/accountValues.ts';
import { SETTING_NAMES, settingExpectation, validSetting } from '../domain/instanceSettings.ts';
import { isCurrencyCode, isRoundingMinutes, isRoundingMode, ROUNDING_MINUTES } from '../domain/workspaceValues.ts';
import { invalidInput } from '../lib/errors.ts';
import { optionalBool, optionalId, optionalRate, optionalString, type JsonBody } from '../lib/values.ts';
import type { AccountChanges } from '../domain/ports.ts';
import type { JsonObject, UserRole } from '../domain/model.ts';

const MAX_INVITE_NOTE_LENGTH = 255;

/** For setup, invite acceptance, password change and reset. A missing value is a 400. */
export function parseNewPassword(value: unknown): string {
  const password = typeof value === 'string' ? value : '';
  if (password.length < MIN_PASSWORD_LENGTH)
    throw invalidInput(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > MAX_PASSWORD_LENGTH)
    throw invalidInput(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  return password;
}

/** An absent or empty timezone is UTC. */
export function parseNewAccount(body: JsonBody): NewAccount {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const fullname = typeof body.fullname === 'string' ? body.fullname.trim().slice(0, MAX_ACCOUNT_TEXT_LENGTH) : '';
  if (!isEmailAddress(email)) throw invalidInput('Enter a valid email address');
  const timezone =
    body.timezone === undefined || body.timezone === ''
      ? 'UTC'
      : typeof body.timezone === 'string'
        ? canonicalTimeZone(body.timezone)
        : null;
  if (!timezone) throw invalidInput('Invalid timezone');
  return { email, fullname, timezone, password: parseNewPassword(body.password) };
}

function role(value: unknown): UserRole {
  if (value !== 'admin' && value !== 'user') throw invalidInput('Invalid role: expected admin or user');
  return value;
}

export function parseInvite(body: JsonBody): InviteRequest {
  const inviteRole = role(body.role);
  return { role: inviteRole, note: optionalString(body.note, 'note', MAX_INVITE_NOTE_LENGTH)?.trim() || null };
}

export function parseAccessChange(body: JsonBody): AccessChange {
  const roleChange = body.role === undefined ? undefined : role(body.role);
  const disabled = optionalBool(body.disabled, 'disabled');
  if (roleChange === undefined && disabled === undefined) throw invalidInput('Expected role or disabled');
  return { role: roleChange, disabled };
}

/** The domain compares it with the account's. */
export function parseDeletionConfirmation(body: JsonBody): string | undefined {
  return typeof body.email === 'string' ? body.email : undefined;
}

function beginningOfWeek(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6)
    throw invalidInput('Invalid beginning_of_week');
  return value;
}

function accountChanges(body: JsonBody): AccountChanges {
  const email = optionalString(body.email, 'email', MAX_ACCOUNT_TEXT_LENGTH)?.trim();
  if (email !== undefined && !isEmailAddress(email)) throw invalidInput('Invalid email');
  const fullName = optionalString(body.fullname, 'fullname', MAX_ACCOUNT_TEXT_LENGTH);
  const requestedZone = optionalString(body.timezone, 'timezone', 64);
  const timezone = requestedZone === undefined ? undefined : canonicalTimeZone(requestedZone);
  if (timezone === null) throw invalidInput('Invalid timezone');
  return {
    email,
    fullName,
    timezone,
    beginningOfWeek: beginningOfWeek(body.beginning_of_week),
    defaultWorkspaceId: optionalId(body.default_workspace_id, 'default_workspace_id') ?? undefined,
  };
}

/** A new password requires the current one. */
export function parseProfileUpdate(body: JsonBody): ProfileUpdate {
  const changes = accountChanges(body);
  if (body.password === undefined) return { changes };
  const password = parseNewPassword(body.password);
  const currentPassword = optionalString(body.current_password, 'current_password', Number.POSITIVE_INFINITY) ?? '';
  return { changes, password: { password, currentPassword } };
}

export function parsePreferenceChanges(body: JsonBody): PreferenceChanges {
  for (const [key, value] of Object.entries(body)) {
    const problem = preferenceProblem(key, value);
    // Only a key with a rule has a problem, so the field is always a preference Tokkl defines.
    if (problem) throw invalidInput(problem, { code: 'invalid_preference', field: key });
  }
  return body as JsonObject;
}

/** Unknown keys and values outside a rule are a 400 naming the field. */
export function parseSettingChanges(body: JsonBody): SettingChanges {
  const changes: SettingChanges = {};
  for (const [name, value] of Object.entries(body)) {
    // An unknown name is client text, so it never becomes the field.
    if (!Object.hasOwn(SETTING_NAMES, name))
      throw invalidInput(`Unknown setting: ${name}`, { code: 'unknown_setting' });
    const key = SETTING_NAMES[name as keyof typeof SETTING_NAMES];
    if (!validSetting(key, value))
      throw invalidInput(`Invalid ${name}: expected ${settingExpectation(key)}`, {
        code: 'invalid_setting',
        field: name,
      });
    changes[key] = value;
  }
  if (!Object.keys(changes).length)
    throw invalidInput('Expected session_days or invite_days or time_resolution_minutes');
  return changes;
}

/** A blank name keeps the current one. */
export function parseWorkspaceChanges(body: JsonBody): WorkspaceChanges {
  const name = optionalString(body.name, 'name', 140)?.trim() || undefined;
  const currency = optionalString(body.default_currency, 'default_currency', 3);
  if (currency !== undefined && !isCurrencyCode(currency)) throw invalidInput('Invalid default_currency');
  const rate = optionalRate(body.default_hourly_rate, 'default_hourly_rate');
  const { rounding, rounding_minutes: roundingMinutes } = body;
  if (rounding !== undefined && !isRoundingMode(rounding)) throw invalidInput('Invalid rounding');
  if (roundingMinutes !== undefined && !isRoundingMinutes(roundingMinutes))
    throw invalidInput(`Invalid rounding_minutes, allowed values are: ${ROUNDING_MINUTES.join(', ')}`);
  return { name, defaultCurrency: currency, defaultHourlyRate: rate, rounding, roundingMinutes };
}
