/**
 * Whether the rows of the previous entries query may stay on screen while `startDate`..`endDate`
 * loads. `previousKey` is that query's key, `['entries', start, end]`. Only a range that covers the
 * previous one keeps its rows, so the list never shows entries from outside the range it is
 * loading.
 */
export function coversPreviousRange(previousKey: readonly unknown[] | undefined, startDate: string, endDate: string): boolean {
  const [, previousStart, previousEnd] = previousKey ?? [];
  return typeof previousStart === 'string' && typeof previousEnd === 'string'
    && startDate <= previousStart && endDate >= previousEnd;
}
