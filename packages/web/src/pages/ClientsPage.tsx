import { useMemo, useRef, useState } from 'react';
import { useWid } from '../api/account.ts';
import { clientRequests, useClients } from '../api/clients.ts';
import { stale } from '../api/keys.ts';
import { useProjects } from '../api/projects.ts';
import type { Client } from '../api/types.ts';
import { Icon } from '../components/Icon.tsx';
import { useAction } from '../components/useAction.ts';
import { ClientEditor } from './manage/ClientEditor.tsx';
import { ClientRow } from './manage/ClientRow.tsx';
import { archiveNotice, deleteNotice, projectCountsByClient, visibleClients } from './manage/clientList.ts';
import { ManageList } from './manage/ManageList.tsx';
import { focusPastRow, keepFocusPastRow } from './manage/rowFocus.ts';
import { ConfirmModal, SearchBox, Segmented } from './manage/ui.tsx';
import { STATUS_OPTIONS, matchesStatus, type StatusFilter } from './manage/values.ts';
import './manage/manage.css';

type Pending = { kind: 'archive' | 'delete'; client: Client };

/** Clients: the list with its filters, the editor and the archive and delete dialogs. */
export function ClientsPage() {
  const wid = useWid();
  const clientsQuery = useClients();
  const { data: clients } = clientsQuery;
  const { data: projects = [] } = useProjects();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const projectCounts = useMemo(() => projectCountsByClient(projects), [projects]);
  const visible = visibleClients(clients ?? [], status, search);

  const archive = useAction<Client>({
    mutationFn: client => clientRequests.archive(wid, client.id),
    invalidate: stale.clients,
    success: (_result, client) => `Archived ${client.name} and its projects`,
    onSuccess: (_result, client) => {
      // The dialog had focus and would give it back to the row's menu button. When the row leaves
      // the list, that button goes with it.
      if (!matchesStatus(true, status)) focusPastRow(tbody.current, client.id, 'menu', heading.current);
      setPending(null);
    },
  });
  const restore = useAction<Client>({
    mutationFn: client => clientRequests.restore(wid, client.id),
    invalidate: stale.clients,
    success: (_result, client) => `Restored ${client.name} and its projects`,
    // The menu button that ran the action had focus; keep it in the list unless the user has moved on.
    onSuccess: (_result, client) => {
      if (!matchesStatus(false, status)) keepFocusPastRow(tbody.current, client.id, 'menu', heading.current);
    },
  });
  const remove = useAction<Client>({
    mutationFn: client => clientRequests.remove(wid, client.id),
    invalidate: stale.clients,
    success: (_result, client) => `Deleted ${client.name}`,
    onSuccess: (_result, client) => {
      focusPastRow(tbody.current, client.id, 'menu', heading.current);
      setPending(null);
    },
  });

  const count = (client: Client) => projectCounts.get(client.id) ?? 0;

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          Clients
        </h1>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> New client
        </button>
      </header>

      <div className="toolbar">
        <Segmented label="Client status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search clients" />
      </div>

      <ManageList
        query={clientsQuery}
        visible={visible}
        noun="clients"
        empty={{ icon: 'users', title: 'No clients yet', body: <>Add one to group projects by who you work for.</> }}
        noMatch={{ title: 'No clients match these filters', body: <>Try another status, or clear the search.</> }}
        headers={
          <>
            <th>Client</th>
            <th>Notes</th>
            <th className="num">Projects</th>
            <th>Status</th>
          </>
        }
        tbodyRef={tbody}
      >
        {visible.map(client => (
          <ClientRow
            key={client.id}
            client={client}
            projects={count(client)}
            onEdit={() => setEditing(client)}
            onArchive={() => setPending({ kind: 'archive', client })}
            onRestore={() => restore.mutate(client)}
            onDelete={() => setPending({ kind: 'delete', client })}
          />
        ))}
      </ManageList>

      {editing ? (
        <ClientEditor
          key={editing === 'new' ? 'new' : editing.id}
          client={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {pending?.kind === 'archive' ? (
        <ConfirmModal
          title={`Archive ${pending.client.name}?`}
          confirmLabel="Archive"
          danger={false}
          busy={archive.isPending}
          onConfirm={() => archive.mutate(pending.client)}
          onClose={() => setPending(null)}
        >
          <p>{archiveNotice(count(pending.client))}</p>
          <p>Restoring the client restores its projects too.</p>
        </ConfirmModal>
      ) : null}

      {pending?.kind === 'delete' ? (
        <ConfirmModal
          title={`Delete ${pending.client.name}?`}
          confirmLabel="Delete client"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(pending.client)}
          onClose={() => setPending(null)}
        >
          <p>{deleteNotice(count(pending.client), pending.client.name)}</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
