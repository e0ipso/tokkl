import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { list, object } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { wsPath } from './paths.ts';
import type { Tag } from '@tokkl/types';

export function useTags() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tags,
    queryFn: ({ signal }) => api.get<Tag[]>(wsPath(wid, 'tags'), { signal, decode: list }),
    enabled: wid > 0,
  });
}

/** Pass them to a mutation with `stale.tags` or `stale.tagCreated`. */
export const tagRequests = {
  create: (wid: number, name: string) => postCreate<Tag>(wsPath(wid, 'tags'), { name }, { decode: object }),
  rename: (wid: number, id: number, name: string) =>
    api.put<Tag>(wsPath(wid, 'tags', id), { name }, { decode: object }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'tags', id)),
};

/** No toast: the picker shows the new tag checked. */
export function useCreateTag() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => tagRequests.create(wid, name),
    onSuccess: () => invalidate(qc, stale.tagCreated),
  });
}
