import {
  interpolate,
  pluralForm,
  type Message,
  type MessageGroup,
  type MessageValue,
  type ParamsOf,
  type PluralMessage,
} from './catalog.ts';
import { calendar } from './en/calendar.ts';
import { common } from './en/common.ts';
import { dates } from './en/dates.ts';
import { entries } from './en/entries.ts';
import { manage } from './en/manage.ts';
import { pomodoro } from './en/pomodoro.ts';
import { reports } from './en/reports.ts';
import { settings } from './en/settings.ts';
import { shell } from './en/shell.ts';
import { timer } from './en/timer.ts';
import { LOCALE } from './locale.ts';

/**
 * The English catalog, the app's only language. Each feature keeps its messages in its own module
 * under `en/`, and a key names the feature and the message: `t('timer.start')`.
 */
export const en = {
  common,
  dates,
  shell,
  timer,
  entries,
  calendar,
  pomodoro,
  reports,
  manage,
  settings,
} as const;

export type Catalog = typeof en;

/**
 * Another language's catalog: the same features and keys, with a plain message where English has
 * one and plural forms where English has them. Placeholders are the translator's to keep.
 */
export type Translation = {
  readonly [Feature in keyof Catalog]: {
    readonly [Key in keyof Catalog[Feature]]: Catalog[Feature][Key] extends PluralMessage ? PluralMessage : string;
  };
};

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

const pluralRules = new Intl.PluralRules(LOCALE);

/**
 * The text of `key` before its placeholders are filled: for a plural message, the form for
 * `count`. A key missing from the catalog comes back as itself.
 */
export function template(key: MessageKey, count?: number): string {
  const dot = key.indexOf('.');
  const group: MessageGroup = en[key.slice(0, dot) as Feature];
  const message = group[key.slice(dot + 1)];
  if (message === undefined) return key;
  return typeof message === 'string' ? message : pluralForm(message, Number(count), pluralRules);
}

/**
 * The message for `key` in the interface language, with its placeholders filled. A plural message
 * picks its form for `params.count`.
 */
export function t<Key extends MessageKey>(key: Key, ...[params]: ParamArgs<Key>): string {
  const values: Readonly<Record<string, MessageValue>> = params ?? {};
  return interpolate(template(key, typeof values.count === 'number' ? values.count : undefined), values);
}
