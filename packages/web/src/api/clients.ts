import { useQuery } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { ignoreReply } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { keys } from './keys.ts';
import { wsPath } from './paths.ts';
import { clientListReply, clientReply } from './replies.ts';

export function useClients() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.clients,
    queryFn: ({ signal }) => api.get(`${wsPath(wid, 'clients')}?status=both`, { signal, decode: clientListReply }),
    enabled: wid > 0,
  });
}

export interface ClientBody {
  name: string;
  notes?: string | null;
}

/**
 * Client writes. Pass them to a mutation together with `stale.clients` or `stale.clientCreated`. A
 * create carries an `Idempotency-Key` (`postCreate` in idempotency.ts).
 */
export const clientRequests = {
  create: (wid: number, body: ClientBody) => postCreate(wsPath(wid, 'clients'), body, { decode: clientReply }),
  update: (wid: number, id: number, body: ClientBody) =>
    api.put(wsPath(wid, 'clients', id), body, { decode: clientReply }),
  /** Archives the client and its projects. */
  archive: (wid: number, id: number) =>
    api.post(wsPath(wid, 'clients', id, 'archive'), undefined, { decode: ignoreReply }),
  /** Restores the client and its projects. */
  restore: (wid: number, id: number) =>
    api.post(wsPath(wid, 'clients', id, 'restore'), { restore_all_projects: true }, { decode: ignoreReply }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'clients', id), undefined, { decode: ignoreReply }),
};
