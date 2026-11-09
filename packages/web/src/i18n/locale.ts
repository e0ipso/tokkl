import { en } from './en/index.ts';

/** The shape of the English catalog, which every message key and parameter type comes from. */
export type Catalog = typeof en;

/**
 * The interface language, English, with its catalog and plural rules. Numbers, percentages and
 * money follow the browser's own locale (`numberLocale` undefined), so a German browser shows
 * "1.234,5" in the English interface.
 */
export const activeLocale = {
  language: 'en',
  catalog: en,
  pluralRules: new Intl.PluralRules('en'),
  numberLocale: undefined,
} as const;
