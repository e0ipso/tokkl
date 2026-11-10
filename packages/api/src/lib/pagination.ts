/** 1-based. */
export interface PageWindow {
  page: number;
  perPage: number;
}

/** A page past the end is empty. */
export function slicePage<T>(items: readonly T[], { page, perPage }: PageWindow): T[] {
  return items.slice((page - 1) * perPage, page * perPage);
}

export interface RowRange {
  offset: number;
  limit: number;
}

/** Undefined for an empty page. Lenient fractional or huge bounds truncate as `Array.prototype.slice` does. */
export function pageRange({ page, perPage }: PageWindow): RowRange | undefined {
  const start = Math.trunc((page - 1) * perPage);
  const end = Math.min(Math.trunc(page * perPage), Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(start) || end <= start) return undefined;
  return { offset: start, limit: end - start };
}

/** Undefined when there are none. Without a `limit` the range runs to the last row. */
export function offsetRange(offset: number, limit = Infinity): RowRange | undefined {
  const start = Math.trunc(offset);
  const end = Math.min(Math.trunc(offset + limit), Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(start) || end <= start) return undefined;
  return { offset: start, limit: end - start };
}
