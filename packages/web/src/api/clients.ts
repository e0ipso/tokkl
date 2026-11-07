import { useQuery } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { wsPath } from './paths.ts';
import type { Client } from './types.ts';

export function useClients() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.clients,
    queryFn: () => api.get<Client[]>(`${wsPath(wid, 'clients')}?status=both`),
    enabled: wid > 0,
  });
}

export interface ClientBody {
  name: string;
  notes?: string | null;
}

/** Client writes. Pass them to a mutation together with `stale.clients` or `stale.clientCreated`. */
export const clientRequests = {
  create: (wid: number, body: ClientBody) => api.post<Client>(wsPath(wid, 'clients'), body),
  update: (wid: number, id: number, body: ClientBody) => api.put<Client>(wsPath(wid, 'clients', id), body),
  /** Archives the client and its projects. */
  archive: (wid: number, id: number) => api.post(wsPath(wid, 'clients', id, 'archive')),
  /** Restores the client and its projects. */
  restore: (wid: number, id: number) => api.post(wsPath(wid, 'clients', id, 'restore'), { restore_all_projects: true }),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'clients', id)),
};
