/** A wrong reply throws `DecodeError`, so it fails like a failed request. */

import { t } from '../i18n/messages.ts';

export type Decoder<T> = (value: unknown) => T;

export class DecodeError extends Error {
  constructor() {
    super(t('api.unreadableReply'));
    this.name = 'DecodeError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fields are trusted: both sides compile against @tokkl/types. */
export function object<T extends object>(value: unknown): T {
  if (!isRecord(value)) throw new DecodeError();
  return value as T;
}

export function list<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new DecodeError();
  return value as T[];
}
