import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { ignoreReply } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { wsPath } from './paths.ts';
import { tagListReply, tagReply } from './replies.ts';

export function useTags() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tags,
    queryFn: ({ signal }) => api.get(wsPath(wid, 'tags'), { signal, decode: tagListReply }),
    enabled: wid > 0,
  });
}

/**
 * Tag writes. Pass them to a mutation together with `stale.tags` or `stale.tagCreated`. A create
 * carries an `Idempotency-Key` (`postCreate` in idempotency.ts).
 */
export const tagRequests = {
  create: (wid: number, name: string) => postCreate(wsPath(wid, 'tags'), { name }, { decode: tagReply }),
  rename: (wid: number, id: number, name: string) => api.put(wsPath(wid, 'tags', id), { name }, { decode: tagReply }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'tags', id), undefined, { decode: ignoreReply }),
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
