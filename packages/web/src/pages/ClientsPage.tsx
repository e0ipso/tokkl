import { useMemo, useRef, useState } from 'react';
import { useWid } from '../api/account.ts';
import { clientRequests, useClients } from '../api/clients.ts';
import { stale } from '../api/keys.ts';
import { useProjects } from '../api/projects.ts';
import type { Client } from '@tokkl/types';
import { Icon } from '../components/Icon.tsx';
import { closeModalThen } from '../components/Overlay.tsx';
import { useAction } from '../components/useAction.ts';
import { ClientEditor } from './manage/ClientEditor.tsx';
import { ClientRow } from './manage/ClientRow.tsx';
import { archiveNotice, deleteNotice, projectCountsByClient, visibleClients } from './manage/clientList.ts';
import { ManageList } from './manage/ManageList.tsx';
import { focusPastRow, keepFocusPastRow } from './manage/rowFocus.ts';
import { ConfirmModal, SearchBox, Segmented } from './manage/ui.tsx';
import { matchesStatus, statusOptions, type StatusFilter } from './manage/values.ts';
import { t } from '../i18n/messages.ts';

type Pending = { kind: 'archive' | 'delete'; client: Client };

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
    movesTimer: true,
    success: (_result, client) => t('manage.clientArchived', { name: client.name }),
    onSuccess: (_result, client) => {
      // The dialog would give focus back to the row's menu button, which leaves with the row.
      closeModalThen(
        () => setPending(null),
        () => {
          if (!matchesStatus(true, status)) focusPastRow(tbody.current, client.id, 'menu', heading.current);
        },
      );
    },
  });
  const restore = useAction<Client>({
    mutationFn: client => clientRequests.restore(wid, client.id),
    invalidate: stale.clients,
    movesTimer: true,
    success: (_result, client) => t('manage.clientRestored', { name: client.name }),
    // The menu button that ran the action had focus; keep it in the list unless the user has moved on.
    onSuccess: (_result, client) => {
      if (!matchesStatus(false, status)) keepFocusPastRow(tbody.current, client.id, 'menu', heading.current);
    },
  });
  const remove = useAction<Client>({
    mutationFn: client => clientRequests.remove(wid, client.id),
    invalidate: stale.clients,
    movesTimer: true,
    success: (_result, client) => t('manage.deletedNamed', { name: client.name }),
    onSuccess: (_result, client) => {
      closeModalThen(
        () => setPending(null),
        () => focusPastRow(tbody.current, client.id, 'menu', heading.current),
      );
    },
  });

  const count = (client: Client) => projectCounts.get(client.id) ?? 0;

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          {t('manage.clientsTitle')}
        </h1>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> {t('manage.newClient')}
        </button>
      </header>

      <div className="toolbar">
        <Segmented label={t('manage.clientStatus')} value={status} options={statusOptions()} onChange={setStatus} />
        <SearchBox value={search} onChange={setSearch} placeholder={t('manage.searchClients')} />
      </div>

      <ManageList
        query={clientsQuery}
        visible={visible}
        noun={t('manage.clientsNoun')}
        empty={{ icon: 'users', title: t('manage.noClientsYet'), body: t('manage.noClientsBody') }}
        noMatch={{ title: t('manage.noClientsMatch'), body: t('manage.noClientsMatchBody') }}
        headers={
          <>
            <th>{t('manage.client')}</th>
            <th>{t('manage.notes')}</th>
            <th className="num">{t('manage.projects')}</th>
            <th>{t('manage.status')}</th>
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
          title={t('manage.archiveNamed', { name: pending.client.name })}
          confirmLabel={t('manage.archive')}
          danger={false}
          busy={archive.isPending}
          onConfirm={() => archive.mutate(pending.client)}
          onClose={() => setPending(null)}
        >
          <p>{archiveNotice(count(pending.client))}</p>
          <p>{t('manage.restoreClientNote')}</p>
        </ConfirmModal>
      ) : null}

      {pending?.kind === 'delete' ? (
        <ConfirmModal
          title={t('manage.deleteNamed', { name: pending.client.name })}
          confirmLabel={t('manage.deleteClient')}
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
