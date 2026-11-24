import { isApiError } from '../../../api/client.ts';

/** The server's refusals for a profile save, matched to show each next to its field. */
const CURRENT_PASSWORD_MESSAGES = ['Current password is required', 'Current password is not valid'];
const EMAIL_IN_USE = 'Email already in use';

export type ProfileField = 'currentPassword' | 'email';

/** Folds only ASCII A-Z, as the server does; toLowerCase would also fold Ä. */
const emailKey = (email: string) => email.trim().replace(/[A-Z]/g, letter => letter.toLowerCase());

/** Whether the server treats the edited email as a change, which needs the current password. */
export function emailChanged(stored: string, edited: string): boolean {
  return emailKey(stored) !== emailKey(edited);
}

/**
 * A 429 (too many failed attempts) stays a toast, so it is not mistaken for a wrong password. So does a password
 * refusal while the password field is hidden: another session changed the email, so the form's copy is stale.
 */
export function refusedProfileField(error: Error, passwordShown: boolean): ProfileField | undefined {
  if (isApiError(error, 429)) return undefined;
  if (CURRENT_PASSWORD_MESSAGES.includes(error.message)) return passwordShown ? 'currentPassword' : undefined;
  if (error.message === EMAIL_IN_USE) return 'email';
  return undefined;
}
