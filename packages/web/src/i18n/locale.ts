import { en } from './en/index.ts';

/** Every message key and parameter type comes from it. */
export type Catalog = typeof en;

/** Numbers and money follow the browser's locale (`numberLocale` undefined), so German shows "1.234,5". */
export const activeLocale = {
  language: 'en',
  catalog: en,
  pluralRules: new Intl.PluralRules('en'),
  numberLocale: undefined,
} as const;
