import type { PluralMessage } from './catalog.ts';
import { en } from './en/index.ts';

/** The shape of the English catalog, which every message key and parameter type comes from. */
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

/** The interface languages the app ships, each with its catalog. English is the only one so far. */
const CATALOGS = { en } as const satisfies Readonly<Record<string, Translation>>;

export type Language = keyof typeof CATALOGS;

/** The interface language when the browser asks for none the app ships. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Everything that depends on the interface language, resolved together. */
export interface Locale {
  /**
   * The interface language. The catalog, the plural rules, and the weekday, month, day period and
   * relative day names in lib/format.ts all use it.
   */
  readonly language: Language;
  readonly catalog: Translation;
  readonly pluralRules: Intl.PluralRules;
  /**
   * The locale numbers, percentages and money are formatted in. They follow the browser's own
   * locale, so a German browser shows "1.234,5" in the English interface. `undefined` asks the
   * runtime for its default.
   */
  readonly numberLocale: string | undefined;
}

function isLanguage(tag: string): tag is Language {
  return Object.hasOwn(CATALOGS, tag);
}

/** The first shipped language among `requested` (BCP 47 tags; "en-GB" matches "en"), or the default. */
export function pickLanguage(requested: readonly string[]): Language {
  for (const tag of requested) {
    const base = tag.toLowerCase().split('-')[0] ?? '';
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** The locale for a browser that prefers the languages in `requested`, most wanted first. */
export function resolveLocale(requested: readonly string[]): Locale {
  const language = pickLanguage(requested);
  return {
    language,
    catalog: CATALOGS[language],
    pluralRules: new Intl.PluralRules(language),
    numberLocale: undefined,
  };
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

/** The locale the app renders in. messages.ts and lib/format.ts read it; nothing else picks a locale. */
export const activeLocale: Locale = resolveLocale(browserLanguages());
