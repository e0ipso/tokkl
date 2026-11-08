/** A 1-based page of `perPage` items. */
export interface PageWindow {
  page: number;
  perPage: number;
}

/** The items of one page; a page past the end is empty. */
export function slicePage<T>(items: readonly T[], { page, perPage }: PageWindow): T[] {
  return items.slice((page - 1) * perPage, page * perPage);
}

/** `limit` items from the 0-based `offset`. */
export function sliceOffset<T>(items: readonly T[], offset: number, limit: number): T[] {
  return items.slice(offset, offset + limit);
}

/** Rows `offset` to `offset + limit` of an ordered query, for SQL `OFFSET` and `LIMIT`. */
export interface RowRange {
  offset: number;
  limit: number;
}

/**
 * The rows `slicePage` keeps, as a range a query can apply, or undefined when the page is empty.
 * Lenient paging lets `page` and `perPage` be fractional or huge, so the bounds truncate the way
 * `Array.prototype.slice` truncates them.
 */
export function pageRange({ page, perPage }: PageWindow): RowRange | undefined {
  const start = Math.trunc((page - 1) * perPage);
  const end = Math.min(Math.trunc(page * perPage), Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(start) || end <= start) return undefined;
  return { offset: start, limit: end - start };
}
