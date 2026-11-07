/**
 * Small runtime checks for server replies. A decoder checks a value and returns it typed when it
 * fits, without converting it, and throws a `DecodeError` naming the first field that does not.
 * Query functions pass one to `api.get`/`api.post`, so a malformed reply fails the query like a
 * failed request does and the view shows its usual load error.
 */

import { t } from '../i18n/messages.ts';

/** Checks a parsed JSON value against `T`, or throws. `at` names the value in the error message. */
export type Decoder<T> = (value: unknown, at?: string) => T;

/** A reply that does not have the shape the views compute with. */
export class DecodeError extends Error {
  /** Where the mismatch is, such as `reply[3].tags`. */
  readonly at: string;

  constructor(at: string, expected: string) {
    super(t('api.unreadableReply', { at, expected }));
    this.name = 'DecodeError';
    this.at = at;
  }
}

const ROOT = 'reply';

function fail(at: string, expected: string): never {
  throw new DecodeError(at, expected);
}

export const string: Decoder<string> = (value, at = ROOT) =>
  typeof value === 'string' ? value : fail(at, t('api.expectText'));

export const number: Decoder<number> = (value, at = ROOT) =>
  typeof value === 'number' ? value : fail(at, t('api.expectNumber'));

export const boolean: Decoder<boolean> = (value, at = ROOT) =>
  typeof value === 'boolean' ? value : fail(at, t('api.expectBoolean'));

/** One of a fixed set of strings, such as a role or a resolution. */
export function oneOf<const V extends readonly string[]>(...values: V): Decoder<V[number]> {
  return (value, at = ROOT) =>
    values.find(candidate => candidate === value) ?? fail(at, t('api.expectOneOf', { values: values.join(', ') }));
}

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, at = ROOT) => (value === null ? null : decode(value, at));
}

/** A field the reply may leave out. */
export function optional<T>(decode: Decoder<T>): Decoder<T | undefined> {
  return (value, at = ROOT) => (value === undefined ? undefined : decode(value, at));
}

export function array<T>(decode: Decoder<T>): Decoder<T[]> {
  return (value, at = ROOT) =>
    Array.isArray(value)
      ? value.map((item: unknown, index) => decode(item, `${at}[${index}]`))
      : fail(at, t('api.expectList'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A decoder for every field of `T`, optional ones included, so a field added to `T` must be checked too. */
export type Fields<T> = { readonly [K in keyof T]-?: Decoder<T[K]> };

/**
 * An object whose listed fields fit their decoders. The object itself comes back, fields beyond
 * the listed ones included, so an object read from the cache and sent back to the server keeps
 * everything it came with.
 */
export function object<T extends object>(fields: Fields<T>): Decoder<T> {
  const entries: Array<[string, Decoder<unknown>]> = Object.entries(fields);
  return (value, at = ROOT) => {
    if (!isRecord(value)) return fail(at, t('api.expectObject'));
    for (const [key, decode] of entries) decode(value[key], `${at}.${key}`);
    // Every field of T was checked above; the record type cannot carry that to the compiler.
    return value as T;
  };
}
