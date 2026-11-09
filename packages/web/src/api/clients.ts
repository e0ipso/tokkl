import { useQuery } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { list, object } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { keys } from './keys.ts';
import { wsPath } from './paths.ts';
import type { Client } from '@tokkl/types';

export function useClients() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.clients,
    queryFn: ({ signal }) => api.get<Client[]>(`${wsPath(wid, 'clients')}?status=both`, { signal, decode: list }),
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
  create: (wid: number, body: ClientBody) => postCreate<Client>(wsPath(wid, 'clients'), body, { decode: object }),
  update: (wid: number, id: number, body: ClientBody) =>
    api.put<Client>(wsPath(wid, 'clients', id), body, { decode: object }),
  /** Archives the client and its projects. */
  archive: (wid: number, id: number) => api.post(wsPath(wid, 'clients', id, 'archive')),
  /** Restores the client and its projects. */
  restore: (wid: number, id: number) => api.post(wsPath(wid, 'clients', id, 'restore'), { restore_all_projects: true }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'clients', id)),
};
