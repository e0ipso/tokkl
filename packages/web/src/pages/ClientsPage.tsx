import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { keys, useClients, useProjects, useWid } from '../api/hooks.ts';
import type { Client } from '../api/types.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { Modal } from '../components/Overlay.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { includesText, useAction, wsPath } from './manage/queries.ts';
import { focusPastRow, keepFocusPastRow } from './manage/rowFocus.ts';
import {
  ConfirmModal, RowMenu, STATUS_OPTIONS, SearchBox, Segmented, StatusBadge, matchesStatus, plural, type StatusFilter,
} from './manage/ui.tsx';
import './manage/manage.css';

const CLIENT_KEYS = [keys.clients, keys.projects, keys.entries, keys.current, keys.report] as const;

function ClientEditor({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const wid = useWid();
  const formId = useId();
  const fields = useFieldErrors<'name'>();
  const [name, setName] = useState(client?.name ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');

  const save = useAction<{ name: string; notes: string | null }, Client>({
    mutationFn: (body) => (client
      ? api.put<Client>(wsPath(wid, 'clients', client.id), body)
      : api.post<Client>(wsPath(wid, 'clients'), body)),
    invalidate: CLIENT_KEYS,
    success: (saved) => (client ? `Saved ${saved.name}` : `Created ${saved.name}`),
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!fields.validate([['name', !name.trim() && 'Enter a client name']])) return;
    save.mutate({ name: name.trim(), notes: notes.trim() || null });
  };

  return (
    <Modal
      title={client ? 'Edit client' : 'New client'}
      onClose={onClose}
      footer={(
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="button button-primary" disabled={save.isPending}>
            {client ? 'Save' : 'Create client'}
          </button>
        </>
      )}
    >
      <form id={formId} className="form-grid" noValidate onSubmit={submit}>
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>Name</label>
          <input {...fields.field('name')} value={name} maxLength={255} required onChange={(event) => setName(event.target.value)} />
          {fields.message('name')}
        </div>
        <label className="field field-full">
          <span>Notes</span>
          <textarea rows={4} value={notes} maxLength={10_000} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

type Pending = { kind: 'archive' | 'delete'; client: Client };

export function ClientsPage() {
  const wid = useWid();
  const { data: clients, isLoading, error, refetch } = useClients();
  const { data: projects = [] } = useProjects();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const projectCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const project of projects) {
      if (project.client_id !== null) counts.set(project.client_id, (counts.get(project.client_id) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  const visible = (clients ?? []).filter((client) =>
    matchesStatus(client.archived, status) && (includesText(client.name, search) || includesText(client.notes, search)));

  const archive = useAction<Client>({
    mutationFn: (client) => api.post(wsPath(wid, 'clients', client.id, 'archive')),
    invalidate: CLIENT_KEYS,
    success: (_result, client) => `Archived ${client.name} and its projects`,
    onSuccess: (_result, client) => {
      // The dialog had focus and would give it back to the row's menu button. When the row leaves
      // the list, that button goes with it.
      if (!matchesStatus(true, status)) focusPastRow(tbody.current, client.id, 'menu', heading.current);
      setPending(null);
    },
  });
  const restore = useAction<Client>({
    mutationFn: (client) => api.post(wsPath(wid, 'clients', client.id, 'restore')),
    invalidate: CLIENT_KEYS,
    success: (_result, client) => `Restored ${client.name} and its projects`,
    // The menu button that ran the action had focus; keep it in the list unless the user has moved on.
    onSuccess: (_result, client) => {
      if (!matchesStatus(false, status)) keepFocusPastRow(tbody.current, client.id, 'menu', heading.current);
    },
  });
  const remove = useAction<Client>({
    mutationFn: (client) => api.delete(wsPath(wid, 'clients', client.id)),
    invalidate: CLIENT_KEYS,
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
        <h1 ref={heading} tabIndex={-1}>Clients</h1>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> New client
        </button>
      </header>

      <div className="toolbar">
        <Segmented label="Client status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search clients" />
      </div>

      {error ? <LoadError message={`Could not load clients: ${error.message}`} onRetry={() => void refetch()} /> : null}
      {isLoading ? <Loading label="Loading clients…" /> : null}
      {clients && visible.length === 0 ? (
        clients.length === 0 ? (
          <EmptyState icon={<Icon name="users" size={32} />} title="No clients yet">
            Add one to group projects by who you work for.
          </EmptyState>
        ) : (
          <EmptyState icon={<Icon name="search" size={32} />} title="No clients match these filters">
            Try another status, or clear the search.
          </EmptyState>
        )
      ) : null}

      {visible.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Notes</th>
                <th className="num">Projects</th>
                <th>Status</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody ref={tbody}>
              {visible.map((client) => (
                <tr key={client.id} data-id={client.id} className={client.archived ? 'archived' : undefined}>
                  <td>
                    <button type="button" className="manage-name-button" onClick={() => setEditing(client)}>{client.name}</button>
                  </td>
                  <td className="manage-notes" title={client.notes ?? undefined}>{client.notes ?? <span className="muted">None</span>}</td>
                  <td className="num">{count(client)}</td>
                  <td><StatusBadge archived={client.archived} /></td>
                  <td className="manage-actions">
                    <button type="button" className="icon-button" aria-label={`Edit ${client.name}`} title="Edit" onClick={() => setEditing(client)}>
                      <Icon name="edit" size={16} />
                    </button>
                    <RowMenu
                      label={`More actions for ${client.name}`}
                      items={[
                        client.archived
                          ? { label: 'Restore', icon: 'undo', onSelect: () => restore.mutate(client) }
                          : { label: 'Archive', onSelect: () => setPending({ kind: 'archive', client }) },
                        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setPending({ kind: 'delete', client }) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <ClientEditor key={editing === 'new' ? 'new' : editing.id} client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
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
          <p>
            {count(pending.client) === 0
              ? 'It has no projects right now.'
              : `This also archives its ${plural(count(pending.client), 'project')}. Archived projects keep their time entries but don't show up when you pick a project.`}
          </p>
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
          <p>
            {count(pending.client) === 0 ? 'It has no projects.' : count(pending.client) === 1
              ? 'Its project stays, without a client.'
              : `Its ${count(pending.client)} projects stay, without a client.`}
            {count(pending.client) === 0 ? null
              : ` If a project without a client already has the same name, "(${pending.client.name})" is added to the moved one.`}
            {' '}Time entries don't change. You can't undo this.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
