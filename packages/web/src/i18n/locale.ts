/**
 * The interface language: the message catalog, weekday and month names, relative day names and
 * plural rules all use it. The app ships one language, so this is fixed, not detected.
 */
export const LOCALE = 'en';

/**
 * The locale numbers and money are formatted in. They follow the browser's own locale, as they
 * always have, so a German browser shows "1.234,5" in the English interface. `undefined` asks the
 * runtime for its default.
 */
export const NUMBER_LOCALE: string | undefined = undefined;
