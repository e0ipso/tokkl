import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from './en/index.ts';
import { DEFAULT_LANGUAGE, activeLocale, pickLanguage, resolveLocale } from './locale.ts';

test('a browser language the app ships is picked, region or not; anything else falls back to English', () => {
  assert.equal(pickLanguage(['en-GB', 'de']), 'en');
  assert.equal(pickLanguage(['EN']), 'en');
  assert.equal(pickLanguage(['de-DE', 'fr']), DEFAULT_LANGUAGE);
  assert.equal(pickLanguage([]), DEFAULT_LANGUAGE);
});

test('the catalog, plural rules and number locale are resolved together', () => {
  const locale = resolveLocale(['de-DE']);
  assert.equal(locale.language, 'en');
  assert.equal(locale.catalog, en);
  assert.equal(locale.pluralRules.resolvedOptions().locale, 'en');
  assert.deepEqual(
    [0, 1, 2].map(count => locale.pluralRules.select(count)),
    ['other', 'one', 'other'],
  );
  // Numbers keep following the browser's own locale, whatever the interface language.
  assert.equal(locale.numberLocale, undefined);
});

test('the app renders in English, the only language it ships', () => {
  assert.equal(activeLocale.language, 'en');
  assert.equal(activeLocale.catalog, en);
  assert.equal(activeLocale.numberLocale, undefined);
});
