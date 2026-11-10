import { Fragment, createElement, type ReactNode } from 'react';
import { template, type MessageKey, type MessageParams } from './messages.ts';

/** Same names as `t`'s, each any React node. */
type RichParams<Key extends MessageKey> = { readonly [Name in keyof MessageParams<Key>]: ReactNode };

/** For markup in a sentence: `tx('settings.apiBase', { api: <code>{url}</code> })`; translations can move it. */
export function tx<Key extends MessageKey>(key: Key, params: RichParams<Key>): ReactNode {
  const values: Readonly<Record<string, ReactNode>> = params;
  const count = typeof values.count === 'number' ? values.count : undefined;
  // Splitting on a capture group puts the placeholder names at the odd indexes.
  const parts = template(key, count).split(/\{(\w+)\}/);
  const children = parts.map((part, index) => (index % 2 === 0 ? part : (values[part] ?? `{${part}}`)));
  return createElement(Fragment, null, ...children.filter(child => child !== ''));
}
