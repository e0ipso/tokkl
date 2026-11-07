import {
  interpolate,
  pluralForm,
  type Message,
  type MessageGroup,
  type MessageValue,
  type ParamsOf,
} from './catalog.ts';
import { activeLocale, type Catalog } from './locale.ts';

type Feature = keyof Catalog & string;

/** Every message key, such as "dates.shortDate". */
export type MessageKey = { [F in Feature]: `${F}.${keyof Catalog[F] & string}` }[Feature];

/** The message a key names. */
type MessageAt<Key extends MessageKey> = Key extends `${infer F extends Feature}.${infer Name}`
  ? Extract<Catalog[F][Name & keyof Catalog[F]], Message>
  : never;

/** The parameters `t` takes for a key: none for a message without placeholders. */
export type MessageParams<Key extends MessageKey> = ParamsOf<MessageAt<Key>>;

type ParamArgs<Key extends MessageKey> = keyof MessageParams<Key> extends never ? [] : [params: MessageParams<Key>];

/**
 * The text of `key` before its placeholders are filled: for a plural message, the form for
 * `count`. A key missing from the catalog comes back as itself.
 */
export function template(key: MessageKey, count?: number): string {
  const dot = key.indexOf('.');
  const group: MessageGroup = activeLocale.catalog[key.slice(0, dot) as Feature];
  const message = group[key.slice(dot + 1)];
  if (message === undefined) return key;
  return typeof message === 'string' ? message : pluralForm(message, Number(count), activeLocale.pluralRules);
}

/**
 * The message for `key` in the interface language, with its placeholders filled. A plural message
 * picks its form for `params.count`.
 */
export function t<Key extends MessageKey>(key: Key, ...[params]: ParamArgs<Key>): string {
  const values: Readonly<Record<string, MessageValue>> = params ?? {};
  return interpolate(template(key, typeof values.count === 'number' ? values.count : undefined), values);
}
