import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Marks every query under `queryKeys` stale and refetches the ones on screen. */
export async function invalidate(qc: QueryClient, queryKeys: readonly QueryKey[]): Promise<void> {
  await Promise.all(queryKeys.map(queryKey => qc.invalidateQueries({ queryKey })));
}
