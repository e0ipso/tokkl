/**
 * Small runtime checks for server replies. A decoder checks a value and returns it typed when it
 * fits, without converting it, and throws a `DecodeError` naming the first field that does not.
 * Every request passes one: a query function's makes a malformed reply fail the query like a failed
 * request does, so the view shows its usual load error, and a write's fails the write.
 */

import { isFiniteNumber, isInstant, isSafeInteger } from '@tokkl/common/validators';
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

/** A finite number, such as an amount or a length in seconds. */
export const number: Decoder<number> = (value, at = ROOT) =>
  isFiniteNumber(value) ? value : fail(at, t('api.expectNumber'));

/** A whole number the client can count with exactly, such as an id, a revision or a page number. */
export const integer: Decoder<number> = (value, at = ROOT) =>
  isSafeInteger(value) ? value : fail(at, t('api.expectInteger'));

/**
 * An RFC 3339 instant with seconds and a zone, such as an entry's start or the server's clock. A
 * date without a time (YYYY-MM-DD) is plain `string`.
 */
export const instant: Decoder<string> = (value, at = ROOT) =>
  isInstant(value) ? value : fail(at, t('api.expectInstant'));

export const boolean: Decoder<boolean> = (value, at = ROOT) =>
  typeof value === 'boolean' ? value : fail(at, t('api.expectBoolean'));

/**
 * For a write whose reply nothing reads, such as a delete or a login: whatever JSON came back, the
 * caller gets nothing, so no view or cache can come to depend on an unchecked reply. A reply that
 * is not JSON still fails, before any decoder runs.
 */
export const ignoreReply: Decoder<void> = () => undefined;

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

/**
 * A list of names that keeps the ones in `known` and drops the rest, such as the capabilities a
 * newer server may add. The value must still be a list of strings.
 */
export function knownNames<K extends string>(known: Readonly<Record<K, true>>): Decoder<K[]> {
  const names = array(string);
  const isKnown = (name: string): name is K => Object.hasOwn(known, name);
  return (value, at = ROOT) => names(value, at).filter(isKnown);
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
