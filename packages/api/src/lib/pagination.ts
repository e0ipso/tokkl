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
