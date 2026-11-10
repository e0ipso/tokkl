import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolate, pluralForm, type ParamsOf, type PluralMessage } from './catalog.ts';
import { activeLocale } from './locale.ts';

const rules = activeLocale.pluralRules;
const entries = { one: '{count} entry', other: '{count} entries' } as const satisfies PluralMessage;

test('placeholders are filled by name, numbers as written, and a missing value stays visible', () => {
  assert.equal(interpolate('Deleted {name}', { name: 'Website' }), 'Deleted Website');
  assert.equal(interpolate('{a} and {a}, then {b}', { a: 'x', b: 1234.5 }), 'x and x, then 1234.5');
  assert.equal(interpolate('Deleted {name}', {}), 'Deleted {name}');
  assert.equal(interpolate('No placeholders', { name: 'unused' }), 'No placeholders');
});

test('English plural forms: one for 1, other for 0, 2 and more', () => {
  const render = (count: number) => interpolate(pluralForm(entries, count, rules), { count });
  assert.deepEqual([0, 1, 2, 21, 1000].map(render), [
    '0 entries',
    '1 entry',
    '2 entries',
    '21 entries',
    '1000 entries',
  ]);
});

test('a plural category the message lacks falls back to other', () => {
  const polish = new Intl.PluralRules('pl');
  assert.equal(polish.select(2), 'few');
  assert.equal(pluralForm(entries, 2, polish), '{count} entries');
});

test('parameter types name every placeholder, and count for a plural message', () => {
  const plain: ParamsOf<'Deleted {name} and {count} more'> = { name: 'Website', count: 2 };
  const counted: ParamsOf<typeof entries> = { count: 3 };
  // @ts-expect-error A plural message needs its count.
  const missing: ParamsOf<typeof entries> = {};
  assert.ok(plain && counted && missing);
});
