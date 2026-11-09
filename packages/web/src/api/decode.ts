/**
 * Top-level checks for server replies. A reply of the wrong kind throws a `DecodeError`, so a read
 * fails like a failed request and a write fails like a failed write.
 */

import { t } from '../i18n/messages.ts';

export type Decoder<T> = (value: unknown) => T;

/** A reply that does not have the shape the views compute with. */
export class DecodeError extends Error {
  constructor() {
    super(t('api.unreadableReply'));
    this.name = 'DecodeError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON object reply. Its fields are trusted to match `T`: both sides compile against @tokkl/types. */
export function object<T extends object>(value: unknown): T {
  if (!isRecord(value)) throw new DecodeError();
  return value as T;
}

/** A JSON array reply, its items trusted like `object`'s fields. */
export function list<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new DecodeError();
  return value as T[];
}
