import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { wsPath } from './paths.ts';
import { tagListReply } from './replies.ts';
import type { Tag } from './types.ts';

export function useTags() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tags,
    queryFn: () => api.get(wsPath(wid, 'tags'), { decode: tagListReply }),
    enabled: wid > 0,
  });
}

/** Tag writes. Pass them to a mutation together with `stale.tags` or `stale.tagCreated`. */
export const tagRequests = {
  create: (wid: number, name: string) => api.post<Tag>(wsPath(wid, 'tags'), { name }),
  rename: (wid: number, id: number, name: string) => api.put<Tag>(wsPath(wid, 'tags', id), { name }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'tags', id)),
};

/** Creates a tag from a picker, with no toast: the picker shows the new tag checked. */
export function useCreateTag() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => tagRequests.create(wid, name),
    onSuccess: () => invalidate(qc, stale.tagCreated),
  });
}
