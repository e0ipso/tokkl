import { Fragment, createElement, type ReactNode } from 'react';
import { template, type MessageKey, type MessageParams } from './messages.ts';

/** `tx`'s parameters: the same names as `t`'s, each any React node, such as a `<code>` element. */
export type RichParams<Key extends MessageKey> = { readonly [Name in keyof MessageParams<Key>]: ReactNode };

/**
 * The message for `key` with its placeholders filled by React nodes, for a sentence that holds
 * markup: `tx('settings.apiBase', { api: <code>{url}</code> })`. The sentence stays whole in the
 * catalog, so a translation can move the markup. A plural message picks its form for a numeric
 * `count`.
 */
export function tx<Key extends MessageKey>(key: Key, params: RichParams<Key>): ReactNode {
  const values: Readonly<Record<string, ReactNode>> = params;
  const count = typeof values.count === 'number' ? values.count : undefined;
  // Splitting on a capture group puts the placeholder names at the odd indexes.
  const parts = template(key, count).split(/\{(\w+)\}/);
  const children = parts.map((part, index) => (index % 2 === 0 ? part : (values[part] ?? `{${part}}`)));
  return createElement(Fragment, null, ...children.filter(child => child !== ''));
}
